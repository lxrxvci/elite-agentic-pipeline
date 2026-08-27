import { and, eq } from "drizzle-orm";
import {
  closeTierDueDate,
  formatLocalDate,
  reportMonthsForFrequency,
  type LocalDate,
} from "@firmos/domain";

import { db } from "@/db";
import {
  clientIntakes,
  clientReports,
  clients,
  contactClientLinks,
  contacts,
  intakeOwners,
  recurringTasks,
} from "@/db/schema";

import { localToday } from "./dates";
import { insertCustomRules } from "./convert";
import {
  IntakeNotFoundError,
  type IntakeCustomRuleInput,
  type IntakeFormData,
  type IntakeOwnerInput,
  type IntakePatch,
  type IntakeReportDefinition,
} from "./intake";
import {
  buildRecurringServicesTemplate,
  calculateIntakeQuoteWithConfig,
  mergeManualTemplateLines,
  quoteAmountStamps,
} from "./quote";

/**
 * Post-conversion cascade (HANDOFF §6.8, _cascade_intake_to_client).
 *
 * A converted intake stays editable; cascadeIntakeToClient propagates ONLY
 * the fields actually submitted in the patch:
 *  - the direct field map (name, address, contacts, staff, billing
 *    modifiers),
 *  - cadence and close tier,
 *  - owners, reconciled (added, re-percentaged, removed),
 *  - accounting method onto recurring rule titles,
 *  - newly added report definitions and custom rules,
 *  - a billing resync when a pricing-relevant field changed (manual_edit
 *    template lines are preserved, §6.5),
 *  - a one-way flip to project engagement.
 */

export class CascadeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CascadeError";
  }
}

export interface CascadeSummary {
  intakeId: number;
  clientId: number;
  clientFieldsUpdated: string[];
  ownersAdded: number;
  ownersRepercentaged: number;
  ownersRemoved: number;
  ruleTitlesUpdated: number;
  reportDefinitionsAdded: number;
  customRulesAdded: number;
  billingResynced: boolean;
  flippedToProject: boolean;
}

/** Direct intake-column -> client-column map (§6.8). */
const DIRECT_FIELD_MAP = {
  legalName: "legalName",
  dbaName: "dbaName",
  businessAddress: "businessAddress",
  businessCity: "businessCity",
  businessState: "businessState",
  businessZip: "businessZip",
  taxStructure: "taxStructure",
  accountingMethod: "accountingMethod",
  managerId: "managerId",
  bookkeeperId: "bookkeeperId",
  monthlyRecurringAmount: "monthlyRecurringAmount",
  baseMonthlyAmount: "baseMonthlyAmount",
  perAccountPrice: "perAccountPrice",
  bookkeepingFrequency: "bookkeepingFrequency",
  billingFrequency: "billingFrequency",
  monthlyCloseTier: "monthlyCloseTier",
} as const satisfies Record<string, keyof typeof clients.$inferInsert>;

/** form_data keys that change the quote (§6.5 pricing-relevant). */
const PRICING_RELEVANT_FORM_KEYS = [
  "serviceKeys",
  "serviceQuantities",
  "customItems",
  "accounts",
  "merchantAccounts",
  "qboClassNames",
  "qboLocationNames",
  "estimated1099Count",
  "include1099Collection",
  "include1099FullManagement",
  "includeMerchantReconciliation",
  "payrollFrequency",
] as const;

const PRICING_RELEVANT_COLUMNS = [
  "bookkeepingFrequency",
  "billingFrequency",
  "monthlyCloseTier",
] as const;

const DEFAULT_RULE_BASE_TITLES = [
  "Reconcile Accounts",
  "Categorize Transactions",
  "Client Questions",
  "Send Reports",
] as const;

function fullName(c: { firstName: string | null; lastName: string | null }): string {
  return [c.firstName, c.lastName].filter(Boolean).join(" ").trim().toLowerCase();
}

export async function cascadeIntakeToClient(
  intakeId: number,
  patch: IntakePatch,
  today: LocalDate = localToday(),
): Promise<CascadeSummary> {
  const [intake] = await db.select().from(clientIntakes).where(eq(clientIntakes.id, intakeId)).limit(1);
  if (!intake) throw new IntakeNotFoundError(intakeId);
  if (intake.clientId == null) {
    throw new CascadeError(`intake ${intakeId} has not been converted - nothing to cascade to`);
  }
  const clientId = intake.clientId;
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) throw new CascadeError(`converted client ${clientId} not found for intake ${intakeId}`);

  const summary: CascadeSummary = {
    intakeId,
    clientId,
    clientFieldsUpdated: [],
    ownersAdded: 0,
    ownersRepercentaged: 0,
    ownersRemoved: 0,
    ruleTitlesUpdated: 0,
    reportDefinitionsAdded: 0,
    customRulesAdded: 0,
    billingResynced: false,
    flippedToProject: false,
  };

  // 1. Direct field map: only the submitted keys move.
  const clientSet: Record<string, unknown> = {};
  for (const [intakeKey, clientKey] of Object.entries(DIRECT_FIELD_MAP)) {
    if (intakeKey in patch) {
      const value = patch[intakeKey as keyof IntakePatch];
      clientSet[clientKey] =
        typeof value === "number" && (intakeKey.endsWith("Amount") || intakeKey === "perAccountPrice")
          ? String(value)
          : value;
      summary.clientFieldsUpdated.push(clientKey);
    }
  }
  if (Object.keys(clientSet).length > 0) {
    clientSet.updatedAt = new Date();
    await db.update(clients).set(clientSet).where(eq(clients.id, clientId));
  }

  // 2. Primary contact propagation (submitted inside form_data.contacts).
  const primaryInput = (patch.formData?.contacts ?? []).find((c) => c.isPrimary);
  if (primaryInput && client.primaryContactId != null) {
    await db
      .update(contacts)
      .set({
        firstName: primaryInput.firstName ?? null,
        lastName: primaryInput.lastName ?? null,
        email: primaryInput.email ?? null,
        phone: primaryInput.phone ?? null,
        updatedAt: new Date(),
      })
      .where(eq(contacts.id, client.primaryContactId));
  }

  // 3. Owners reconciled: added, re-percentaged, removed (§6.8).
  const submittedOwners = patch.owners ?? (patch.formData?.owners as IntakeOwnerInput[] | undefined);
  if (submittedOwners) {
    const links = await db
      .select({
        linkId: contactClientLinks.id,
        contactId: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        ownershipPercent: contactClientLinks.ownershipPercent,
      })
      .from(contactClientLinks)
      .innerJoin(contacts, eq(contacts.id, contactClientLinks.contactId))
      .where(
        and(
          eq(contactClientLinks.clientId, clientId),
          eq(contactClientLinks.relationshipType, "owner"),
        ),
      );
    const byName = new Map(links.map((l) => [fullName(l), l]));
    const seen = new Set<string>();

    for (const owner of submittedOwners) {
      const key = owner.name.trim().toLowerCase();
      seen.add(key);
      const percent = owner.ownershipPercent == null ? null : String(owner.ownershipPercent);
      const existing = byName.get(key);
      if (existing) {
        if (existing.ownershipPercent !== percent) {
          await db
            .update(contactClientLinks)
            .set({ ownershipPercent: percent })
            .where(eq(contactClientLinks.id, existing.linkId));
          summary.ownersRepercentaged += 1;
        }
      } else {
        const parts = owner.name.trim().split(/\s+/);
        const [contact] = await db
          .insert(contacts)
          .values({
            type: "individual",
            firstName: parts[0],
            lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
            email: owner.email ?? null,
          })
          .returning();
        await db.insert(contactClientLinks).values({
          contactId: contact.id,
          clientId,
          relationshipType: "owner",
          ownershipPercent: percent,
        });
        summary.ownersAdded += 1;
      }
    }
    for (const link of links) {
      if (!seen.has(fullName(link))) {
        await db.delete(contactClientLinks).where(eq(contactClientLinks.id, link.linkId));
        // Keep the intake_owners row but drop its contact link.
        await db
          .update(intakeOwners)
          .set({ contactId: null })
          .where(and(eq(intakeOwners.intakeId, intakeId), eq(intakeOwners.contactId, link.contactId)));
        summary.ownersRemoved += 1;
      }
    }
  }

  // 4. Accounting method onto recurring rule titles: "Reconcile Accounts"
  //    becomes "Reconcile Accounts (accrual)". Only the four default rules.
  if (patch.accountingMethod) {
    const method = patch.accountingMethod;
    const rules = await db
      .select()
      .from(recurringTasks)
      .where(eq(recurringTasks.clientId, clientId));
    for (const rule of rules) {
      const base = DEFAULT_RULE_BASE_TITLES.find(
        (t) => rule.title === t || rule.title.startsWith(`${t} (`),
      );
      if (!base) continue;
      const next = `${base} (${method})`;
      if (rule.title !== next) {
        await db.update(recurringTasks).set({ title: next }).where(eq(recurringTasks.id, rule.id));
        summary.ruleTitlesUpdated += 1;
      }
    }
  }

  // 5. Newly added report definitions: materialize the remaining months of
  //    the current year (past months stay untouched - no fake overdues).
  if (patch.reportDefinitions) {
    const tier = ((): 5 | 10 | 15 => {
      const n = client.monthlyCloseTier == null ? 15 : Number(client.monthlyCloseTier);
      return n === 5 || n === 10 ? n : 15;
    })();
    for (const def of patch.reportDefinitions as IntakeReportDefinition[]) {
      const [existing] = await db
        .select({ id: clientReports.id })
        .from(clientReports)
        .where(and(eq(clientReports.clientId, clientId), eq(clientReports.name, def.name)))
        .limit(1);
      if (existing) continue;
      let added = false;
      for (const month of reportMonthsForFrequency(def.frequency)) {
        if (month < today.month) continue;
        const due = closeTierDueDate({ year: today.year, month }, tier);
        const inserted = await db
          .insert(clientReports)
          .values({
            clientId,
            name: def.name,
            attributedYear: today.year,
            attributedMonth: month,
            dueDate: formatLocalDate(due),
          })
          .onConflictDoNothing()
          .returning({ id: clientReports.id });
        if (inserted.length > 0) added = true;
      }
      if (added) summary.reportDefinitionsAdded += 1;
    }
  }

  // 6. Newly added custom rules (matched by title against active rules).
  if (patch.customRecurringRules) {
    const existingRules = await db
      .select({ title: recurringTasks.title })
      .from(recurringTasks)
      .where(and(eq(recurringTasks.clientId, clientId), eq(recurringTasks.isActive, true)));
    const titles = new Set(existingRules.map((r) => r.title));
    const fresh = (patch.customRecurringRules as IntakeCustomRuleInput[]).filter(
      (r) => !titles.has(r.title),
    );
    if (fresh.length > 0) {
      summary.customRulesAdded = await insertCustomRules(
        db,
        clientId,
        fresh,
        { managerId: client.managerId, bookkeeperId: client.bookkeeperId },
        client.bookkeepingStartDate,
        today,
      );
    }
  }

  // 7. Billing resync when a pricing-relevant field changed (§6.5). Manual
  //    template lines are preserved: a manual line wins for its key and
  //    manual extras are appended.
  const formKeys = Object.keys(patch.formData ?? {});
  const pricingTouched =
    PRICING_RELEVANT_COLUMNS.some((k) => k in patch) ||
    PRICING_RELEVANT_FORM_KEYS.some((k) => formKeys.includes(k));
  if (pricingTouched) {
    const [fresh] = await db
      .select()
      .from(clientIntakes)
      .where(eq(clientIntakes.id, intakeId))
      .limit(1);
    const form = (fresh?.formData ?? {}) as IntakeFormData;
    const quote = await calculateIntakeQuoteWithConfig({
      ...form,
      bookkeepingFrequency: fresh?.bookkeepingFrequency ?? null,
    });
    const rebuilt = buildRecurringServicesTemplate(quote, form.customItems ?? []);
    const merged = mergeManualTemplateLines(rebuilt, client.recurringServicesTemplate);
    const stamps = quoteAmountStamps(quote);
    await db
      .update(clients)
      .set({
        recurringServicesTemplate: merged,
        monthlyRecurringAmount: stamps.monthlyRecurringAmount,
        baseMonthlyAmount: stamps.baseMonthlyAmount,
        perAccountPrice: stamps.perAccountPrice,
        billingLastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(clients.id, clientId));
    summary.billingResynced = true;
  }

  // 8. One-way flip to project engagement (§6.8): never flips back. Turns
  //    off weekly bank feeds and disables every recurring rule.
  if (patch.engagementType === "project" && !client.isProjectEngagement) {
    await db
      .update(clients)
      .set({
        isProjectEngagement: true,
        projectCutoffDate: formatLocalDate(today),
        requiresWeeklyBankFeeds: false,
        updatedAt: new Date(),
      })
      .where(eq(clients.id, clientId));
    await db
      .update(recurringTasks)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(recurringTasks.clientId, clientId));
    summary.flippedToProject = true;
  }

  return summary;
}
