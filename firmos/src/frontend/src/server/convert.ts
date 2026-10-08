import { sql, inArray } from "drizzle-orm";
import {
  addDays,
  closeTierDueDate,
  compareLocalDate,
  effectiveDueDate,
  formatLocalDate,
  nextRunFrom,
  parseLocalDate,
  reportMonthsForFrequency,
  workPeriodForDue,
  type LocalDate,
  type Month,
} from "@firmos/domain";

import { requiresOfficerPayroll, deriveRoutineTasks, type WizardAnswers } from "@/components/intake/registry";
import { db } from "@/db";
import {
  accounts,
  clientIntakes,
  clientNotes,
  clientReports,
  clients,
  contactClientLinks,
  contacts,
  correspondence,
  institutions,
  intakeOwners,
  merchantProcessors,
  onboardingTemplateTasks,
  projects,
  projectTasks,
  properties,
  recurringTasks,
  recurringTaskSubtasks,
  tasks,
} from "@/db/schema";
import { accountLabel, normalizeLast4 } from "@/shared/lib/account-label";
import {
  planRoutineSeeds,
  type RoutineSchedule,
} from "@/shared/lib/routine-schedule";
import { DEPRECIATION_FIELDS, type DepreciationBreakdown } from "@/shared/lib/proforma";
import {
  DEFAULT_RECURRING_RULES,
  MERCHANT_RECONCILIATION_TITLE,
  NON_BUSINESS_DEPOSITS_REVIEW_TITLE,
  OWNER_DRAWS_CONFIRMATION_TITLE,
  PERSONAL_CARD_REMINDER_TITLE,
  PRELIMINARY_REPORTS_NOTE,
} from "@/shared/lib/default-rules";

import {
  defaultStatementDayFor,
  proofCategoryFor,
  seedDefaultAccounts,
  statementDayForIntakeAccount,
  type DbOrTx,
} from "./accounts-seed";
import { contactIdentityKey } from "./contact-lookup";
import { autoLinkInstitutionSops } from "./templates";
import { sendWelcomeEmail } from "./correspondence";
import { localToday } from "./dates";
import {
  assertIntakeTransition,
  type IntakeAccountInput,
  type IntakeCustomRuleInput,
  type IntakeFormData,
  type IntakeRow,
} from "./intake";
import { materializeOperationalRows, reportDefinitionsOf } from "./materialize";
import { catchUpRangesFor } from "./projects";
import {
  buildRecurringServicesTemplate,
  calculateIntakeQuoteWithConfig,
  quoteAmountStamps,
  specialtyReportsFromIntake,
} from "./quote";
import { runRecurringOnce } from "./recurring";
import { seedExpectedCredentialSlots } from "./vault";

/**
 * Intake -> client conversion (HANDOFF §6.8, routes_intake.py).
 *
 * Staff assignment is OPTIONAL at conversion (owner call notes: "this should
 * be an admin thing once it's been converted"): managerId/bookkeeperId fall
 * back to the intake's saved values and may both end up null. The client,
 * its onboarding tasks, and its default recurring rules then carry null
 * assignees until someone assigns the team from the client record.
 *
 * ONE transaction creates, in order: the client record, the billing
 * template, client notes, contacts (+ owner links), accounts (intake +
 * default seeds + pre-conversion overrides), real-estate properties (when
 * the intake is real-estate specific), recurring rules (defaults +
 * custom), onboarding tasks, catch-up projects (one per calendar year of
 * retroactive scope), and report tracking rows; then it links the
 * intake and stamps converted_at. Any failure rolls EVERYTHING back - the
 * §29 bare-client bug (create_client committed before seeding related
 * records) is dead by construction.
 *
 * The intake row is locked FOR UPDATE first, so two concurrent conversions
 * cannot both pass the already-converted check (the §29 orphan-client bug:
 * the original guard did not lock).
 *
 * The current year's recurring task instances are generated immediately
 * after the transaction commits by calling the existing engine paths
 * (runRecurringOnce + materializeOperationalRows). They are global,
 * idempotent, and bound to the shared db handle, so they cannot run inside
 * the transaction; a failure there is logged and converges on the next
 * daily run rather than rolling back an otherwise complete conversion.
 */

export class ConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversionError";
  }
}

export interface ConversionStaff {
  managerId?: number | null;
  bookkeeperId?: number | null;
}

export interface ConversionResult {
  intakeId: number;
  clientId: number;
  isProjectEngagement: boolean;
  contactsCreated: number;
  /** J1 (C4): existing contacts linked instead of duplicated (picker picks
   *  and normalized name+email matches). One person = one record. */
  contactsLinked: number;
  ownerLinksCreated: number;
  accountsCreated: number;
  propertiesCreated: number;
  recurringRulesCreated: number;
  onboardingTasksCreated: number;
  /** §20 - one catch-up project per calendar year of retroactive scope. */
  catchUpProjectsCreated: number;
  reportRowsCreated: number;
  /** 3B - vault slots opened for accounts flagged "grant us login access". */
  credentialsExpectedCreated: number;
  /** null when the post-commit generation pass failed (see header). */
  tasksGenerated: number | null;
  /** Correspondence hub: the welcome mail went out (portal on + contact with email). */
  welcomeEmailSent: boolean;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function formOf(intake: IntakeRow): IntakeFormData {
  return (intake.formData ?? {}) as IntakeFormData;
}

function splitName(name: string): { firstName: string; lastName: string | null } {
  const parts = name.trim().split(/\s+/);
  return { firstName: parts[0] ?? name.trim(), lastName: parts.length > 1 ? parts.slice(1).join(" ") : null };
}

// ── J1 contact dedup (C4, 00:07:40): one person = one record ──────────────

type ContactRow = typeof contacts.$inferSelect;

/**
 * Find an existing contact by NORMALIZED name+email (both required - a
 * name-only collision never merges two people). Runs inside the conversion
 * transaction, so a contact created moments earlier in the same conversion
 * (the primary contact, say) is visible to the owners loop: the person who
 * is both primary contact and owner gets ONE record with two role links.
 */
async function findContactByNameEmail(
  tx: Tx,
  name: string,
  email: string | null | undefined,
): Promise<ContactRow | null> {
  const key = contactIdentityKey(name, email);
  if (!key) return null;
  const [n, e] = key.split("|");
  const [row] = await tx
    .select()
    .from(contacts)
    .where(
      sql`lower(btrim(${contacts.email})) = ${e} and (
        lower(btrim(concat_ws(' ', ${contacts.firstName}, ${contacts.lastName}))) = ${n}
        or lower(btrim(${contacts.entityName})) = ${n}
      )`,
    )
    .limit(1);
  return row ?? null;
}

/** J1 (C5): a picker-linked contact id - verified it still exists. */
async function findContactById(tx: Tx, id: number): Promise<ContactRow | null> {
  const [row] = await tx.select().from(contacts).where(sql`${contacts.id} = ${id}`).limit(1);
  return row ?? null;
}

// ── Recurring rules (§19 defaults, cadence-aware) ─────────────────────────

interface DefaultRuleSpec {
  key: string;
  title: string;
  assignee: "manager" | "bookkeeper";
  dayOfMonth: number;
}

/**
 * The four defaults (§19) from the shared canonical list; the tier day is
 * the close-work due day on monthly clients. B21: the intake wizard renders
 * these as a pre-selected checklist; keys in form_data.excludedDefaultRules
 * are unselected there and skipped here.
 */
function defaultRuleSpecs(tierDay: number, excludedKeys: ReadonlySet<string> = new Set()): DefaultRuleSpec[] {
  return DEFAULT_RECURRING_RULES.filter((r) => !excludedKeys.has(r.key)).map((r) => ({
    key: r.key,
    title: r.title,
    assignee: r.assignee,
    dayOfMonth: r.dueDay === "tier" ? tierDay : r.dueDay,
  }));
}

// The B18/A41/I6 seeded-task titles live in shared/lib/default-rules.ts (the
// J3 scheduler screen renders the same cards client-side); re-exported here
// for the existing test/server imports.
export {
  MERCHANT_RECONCILIATION_TITLE,
  NON_BUSINESS_DEPOSITS_REVIEW_TITLE,
  OWNER_DRAWS_CONFIRMATION_TITLE,
  PERSONAL_CARD_REMINDER_TITLE,
} from "@/shared/lib/default-rules";
import { EOY_TAX_CHECKLIST_ITEMS, EOY_TAX_CHECKLIST_TITLE } from "@/shared/lib/default-rules";
/** B18: the reminder lands on the 1st, asking for the prior month's breakdown. */
const PERSONAL_CARD_REMINDER_DAY = 1;

function scheduleForCadence(
  frequency: string | null | undefined,
  anchorMonth: number,
): { scheduleType: "monthly" | "quarterly" | "semi_annual" | "annual"; anchorMonth: number | null } {
  switch (frequency) {
    case "quarterly":
      return { scheduleType: "quarterly", anchorMonth };
    case "semi_annual":
      return { scheduleType: "semi_annual", anchorMonth };
    case "annual":
      return { scheduleType: "annual", anchorMonth };
    default:
      return { scheduleType: "monthly", anchorMonth: null };
  }
}

/** First occurrence on/after the later of the bookkeeping start and Jan 1 of today. */
function initialNextRun(
  rule: Parameters<typeof nextRunFrom>[0],
  bookkeepingStartDate: string | null,
  today: LocalDate,
): string {
  let anchor: LocalDate = { year: today.year, month: 1, day: 1 };
  if (bookkeepingStartDate) {
    const start = parseLocalDate(bookkeepingStartDate);
    if (compareLocalDate(start, anchor) > 0) anchor = start;
  }
  return formatLocalDate(nextRunFrom(rule, anchor));
}

export async function insertCustomRules(
  dbOrTx: DbOrTx,
  clientId: number,
  rules: IntakeCustomRuleInput[],
  staff: { managerId: number | null; bookkeeperId: number | null },
  bookkeepingStartDate: string | null,
  today: LocalDate,
): Promise<number> {
  let created = 0;
  for (const rule of rules) {
    const nextRun = initialNextRun(
      {
        schedule_type: rule.scheduleType,
        days_of_week: rule.daysOfWeek ?? null,
        day_of_month: rule.dayOfMonth ?? null,
        weekday: rule.weekday ?? null,
        week_of_month: rule.weekOfMonth ?? null,
        anchor_month: rule.anchorMonth ?? null,
        week_interval: rule.weekInterval ?? null,
        next_run: bookkeepingStartDate ?? formatLocalDate(today),
      },
      bookkeepingStartDate,
      today,
    );
    const [inserted] = await dbOrTx
      .insert(recurringTasks)
      .values({
        clientId,
        title: rule.title,
        description: rule.description ?? null,
        scheduleType: rule.scheduleType,
        daysOfWeek: rule.daysOfWeek ?? null,
        dayOfMonth: rule.dayOfMonth ?? null,
        weekday: rule.weekday ?? null,
        weekOfMonth: rule.weekOfMonth ?? null,
        anchorMonth: rule.anchorMonth ?? null,
        weekInterval: rule.weekInterval ?? null,
        nextRun,
        isCustom: true,
        isBillable: rule.isBillable ?? false,
        unitPrice: rule.unitPrice == null ? null : String(rule.unitPrice),
        assigneeId: staff.bookkeeperId,
      })
      .returning();
    if (rule.subtasks && rule.subtasks.length > 0) {
      await dbOrTx.insert(recurringTaskSubtasks).values(
        rule.subtasks.map((title, position) => ({
          recurringTaskId: inserted.id,
          title,
          position,
        })),
      );
    }
    created += 1;
  }
  return created;
}

// ── J3 scheduler path (meeting #3, R1-R5, 00:39:26-00:54:05) ─────────────

/**
 * Every entry in form_data.routineSchedule becomes one recurring rule with
 * the cadence the "Routine order and frequency" screen showed. The derived
 * card list (registry.deriveRoutineTasks) mirrors the legacy seeding rules,
 * so a committed-but-unmodified schedule reproduces today's seeds and adds
 * the answer-implied add-on tasks (payroll handling, bills, 1099s) that
 * pre-J3 lived only as quote lines.
 */
async function seedFromRoutineSchedule(
  tx: Tx,
  clientId: number,
  intake: IntakeRow,
  form: IntakeFormData,
  routineSchedule: RoutineSchedule,
  staff: { managerId: number | null; bookkeeperId: number | null },
  today: LocalDate,
): Promise<number> {
  const tierRaw = Number(intake.monthlyCloseTier ?? form.monthlyCloseTier);
  const tierDay = tierRaw === 5 || tierRaw === 10 ? tierRaw : 15;
  const answers: WizardAnswers = {
    ...form,
    taxStructure: intake.taxStructure,
    bookkeepingFrequency: intake.bookkeepingFrequency ?? form.bookkeepingFrequency ?? null,
    monthlyCloseTier: intake.monthlyCloseTier ?? form.monthlyCloseTier ?? null,
    bookkeepingStartDate: intake.bookkeepingStartDate ?? form.bookkeepingStartDate ?? null,
    // The structured columns win when populated (the wizard writes both;
    // extraction/API payloads may carry only the column) - same fallback the
    // legacy path uses below.
    reportDefinitions: reportDefinitionsOf(intake),
    customRecurringRules:
      (intake.customRecurringRules as IntakeCustomRuleInput[] | null) ?? form.customRecurringRules ?? [],
  };
  const seeds = planRoutineSeeds(deriveRoutineTasks(answers), routineSchedule, { tierDay });
  let created = 0;
  for (const seed of seeds) {
    const nextRun = initialNextRun(
      {
        schedule_type: seed.scheduleType,
        days_of_week: seed.daysOfWeek,
        day_of_month: seed.dayOfMonth,
        weekday: seed.weekday,
        week_of_month: seed.weekOfMonth,
        anchor_month: seed.anchorMonth,
        week_interval: seed.weekInterval,
        next_run: intake.bookkeepingStartDate ?? formatLocalDate(today),
      },
      intake.bookkeepingStartDate,
      today,
    );
    const [inserted] = await tx
      .insert(recurringTasks)
      .values({
        clientId,
        title: seed.title,
        description: seed.description,
        scheduleType: seed.scheduleType,
        daysOfWeek: seed.daysOfWeek,
        dayOfMonth: seed.dayOfMonth,
        weekday: seed.weekday,
        weekOfMonth: seed.weekOfMonth,
        anchorMonth: seed.anchorMonth,
        weekInterval: seed.weekInterval,
        nextRun,
        isCustom: seed.isCustom,
        isBillable: seed.isBillable,
        unitPrice: seed.unitPrice == null ? null : String(seed.unitPrice),
        assigneeId: seed.assignee === "manager" ? staff.managerId : staff.bookkeeperId,
      })
      .returning();
    if (seed.subtasks.length > 0) {
      await tx.insert(recurringTaskSubtasks).values(
        seed.subtasks.map((title, position) => ({ recurringTaskId: inserted.id, title, position })),
      );
    }
    created += 1;
  }
  return created;
}

// ── Conversion ────────────────────────────────────────────────────────────

export async function convertIntakeToClient(
  intakeId: number,
  staff: ConversionStaff,
  userId: number,
  today: LocalDate = localToday(),
): Promise<ConversionResult> {
  const result = await db.transaction(async (tx) => {
    // §29 fix: lock the intake row so a concurrent conversion blocks here
    // and then sees the committed client_id instead of orphaning a client.
    await tx.execute(sql`SELECT id FROM client_intakes WHERE id = ${intakeId} FOR UPDATE`);

    const [intake] = await tx
      .select()
      .from(clientIntakes)
      .where(sql`${clientIntakes.id} = ${intakeId}`)
      .limit(1);
    if (!intake) throw new ConversionError(`intake not found: ${intakeId}`);
    if (intake.clientId != null) {
      throw new ConversionError(`intake ${intakeId} has already been converted to client ${intake.clientId}`);
    }
    try {
      assertIntakeTransition(intake.status, "completed");
    } catch {
      throw new ConversionError(
        `intake ${intakeId} must be in pending_review to convert (status: ${intake.status})`,
      );
    }

    // Staff is optional at conversion: explicit picks win, then the intake's
    // saved values, then null (assignment happens post-conversion from the
    // client record).
    const managerId = staff.managerId ?? intake.managerId;
    const bookkeeperId = staff.bookkeeperId ?? intake.bookkeeperId;

    const form = formOf(intake);

    // K7 (C1/J5, 09_30 00:13:10-00:17:06): the conversion completeness gate.
    // Discovery keeps identifiers optional; conversion requires them. The
    // error lists exactly what's missing per account so the fix is one
    // re-walk away (the review screen's edit overlay makes it in-place).
    {
      const missing: string[] = [];
      const MONEY_TYPES = new Set(["checking", "savings", "credit_card"]);
      for (const a of form.accounts ?? []) {
        const type = String(a.accountType ?? "");
        const label = a.name ?? `${type} account`;
        if (MONEY_TYPES.has(type)) {
          // The J1 standardized label ("Chase Checking · 4411") embeds the
          // bank; otherwise the explicit institution field/id carries it.
          const labelHasBank = typeof a.name === "string" && a.name.includes(" · ");
          if (a.institutionId == null && (a.institution ?? "").trim() === "" && !labelHasBank) {
            missing.push(`${label}: pick the bank`);
          }
          if (normalizeLast4(a.last4) == null) {
            missing.push(`${label}: the last 4 digits`);
          }
        }
        if (type === "loan" && (a.proofCategory ?? "statement") === "statement") {
          if ((a.lender ?? "").trim() === "" && a.lenderInstitutionId == null) {
            missing.push(`${label}: the lender`);
          }
        }
      }
      if (missing.length > 0) {
        throw new ConversionError(
          `A few identifiers are still missing (they're optional during discovery, required to convert): ${missing.join("; ")}.`,
        );
      }
    }

    // I1 (00:31:05): consulting runs on the project-engagement track - no
    // recurring rule seeding, no report rows, no weekly bank feeds. A custom
    // "Other" engagement (I1) takes the project track too: the wizard already
    // skipped the recurring-books chapters for it, so seeding them here would
    // mis-map the answer.
    const engagementType = intake.engagementType ?? form.engagementType;
    const isProject = (engagementType ?? "bookkeeping") !== "bookkeeping";

    // Billing template from the quote (§6.5 price flow, server-side only),
    // priced against the admin-configured table. The report-definitions
    // structured column is the fallback when form_data lacks it (the wizard
    // writes both; API-created intakes may carry only the column) - C10.
    const quote = await calculateIntakeQuoteWithConfig(
      {
        ...form,
        reportDefinitions:
          form.reportDefinitions ??
          (intake.reportDefinitions as IntakeFormData["reportDefinitions"] | null) ??
          undefined,
        bookkeepingFrequency: intake.bookkeepingFrequency,
      },
      today,
    );
    const template = buildRecurringServicesTemplate(
      quote,
      form.customItems ?? [],
      // J2: the same `today` as the quote, so derived missed-filing counts
      // match between the quote lines and the template.
      specialtyReportsFromIntake(
        {
          reportDefinitions:
            form.reportDefinitions ??
            (intake.reportDefinitions as IntakeFormData["reportDefinitions"] | null) ??
            undefined,
        },
        today,
      ),
      // L4 (G8): the weekly custom rules' weekday schedules ride onto the
      // template lines so invoicing bills real occurrence counts.
      form.customRecurringRules ?? [],
      // L4 (G9): billing-month assignments - an annual line bills its full
      // quantity in the assigned month instead of spreading across the year.
      form.billingMonths ?? {},
    );
    const stamps = quoteAmountStamps(quote);

    // 1. Client record.
    const [client] = await tx
      .insert(clients)
      .values({
        legalName: intake.legalName,
        dbaName: intake.dbaName,
        taxId: intake.taxId,
        taxStructure: intake.taxStructure,
        accountingMethod: intake.accountingMethod,
        businessAddress: intake.businessAddress,
        businessCity: intake.businessCity,
        businessState: intake.businessState,
        businessZip: intake.businessZip,
        bookkeepingFrequency: intake.bookkeepingFrequency ?? "monthly",
        billingFrequency: intake.billingFrequency ?? "monthly",
        monthlyCloseTier: intake.monthlyCloseTier,
        bookkeepingStartDate: intake.bookkeepingStartDate,
        bankFeedCatchupDate: intake.bankFeedCatchupDate,
        managerId,
        bookkeeperId,
        monthlyRecurringAmount: stamps.monthlyRecurringAmount,
        baseMonthlyAmount: stamps.baseMonthlyAmount,
        perAccountPrice: stamps.perAccountPrice,
        recurringServicesTemplate: template,
        billingLastSyncedAt: new Date(),
        estimated1099Count: form.estimated1099Count ?? null,
        include1099Collection: form.include1099Collection ?? false,
        include1099FullManagement: form.include1099FullManagement ?? false,
        includeMerchantReconciliation: form.includeMerchantReconciliation ?? false,
        qboClassNames: form.qboClassNames ?? null,
        qboLocationNames: form.qboLocationNames ?? null,
        // QBO pass-through facts (§15): captured in the wizard, priced into
        // the quote, and kept on the client record for the Overview.
        qboUserCount: form.qboUserCount ?? null,
        qboSubscriptionTier: form.qboSubscriptionTier ?? null,
        isRealEstateClient: form.isRealEstateClient === true,
        // E11: the payroll answer gates payroll/W-2 year-end checklist items.
        // I2 (00:48:07-00:49:44): a corporate structure (S Corp, C Corp, or
        // LLC taxed as one) legally requires an officer on payroll, so the
        // stamp holds even if the payroll answer somehow went unanswered.
        hasPayroll:
          form.hasPayroll === true ||
          requiresOfficerPayroll({
            taxStructure: intake.taxStructure,
            llcSubclass: form.llcSubclass,
          }),
        // I6 (logic map): the payroll provider captured on the intake rides
        // onto the client so the year-end package work knows where the
        // payroll reports come from.
        payrollProvider: intake.payrollProvider ?? form.payrollProvider ?? null,
        isProjectEngagement: isProject,
        requiresWeeklyBankFeeds: !isProject,
      })
      .returning();
    const clientId = client.id;

    // 2. Client note from the intake's internal notes.
    if (intake.internalNotes && intake.internalNotes.trim().length > 0) {
      await tx.insert(clientNotes).values({
        clientId,
        authorId: userId,
        body: intake.internalNotes,
      });
    }
    // The wizard's running-notes rail entries carry through the same path,
    // one client note per entry, oldest first.
    for (const note of form.runningNotes ?? []) {
      if (typeof note?.text === "string" && note.text.trim().length > 0) {
        await tx.insert(clientNotes).values({
          clientId,
          authorId: userId,
          body: note.text,
        });
      }
    }
    // J2 (E6): the bills split lands as client-record context - the record
    // side prices via the record_bills service key; the pay side and its
    // locations are operational context, so they ride the notes channel
    // (same home as internal/running notes).
    if ((form.recordBills ?? form.includeBillPay) === true) {
      const locations = (form.billPayLocations ?? [])
        .filter((l): l is string => typeof l === "string" && l.trim() !== "")
        .map((l) => l.trim());
      const body =
        form.payBills === true
          ? `Bills: we record and pay them.${locations.length > 0 ? ` Bills get paid at: ${locations.join(", ")}.` : ""}`
          : "Bills: we record them; the client pays their own.";
      await tx.insert(clientNotes).values({ clientId, authorId: userId, body });
    }
    // J2 (P1): self-processed payroll is context, not a service - no
    // payroll-processing work seeds from it (process_payroll stays a quote
    // line only, and the wizard never pairs the two). The note tells the
    // team where the reports come from.
    if (form.payrollSelfProcessed === true) {
      const provider = intake.payrollProvider ?? form.payrollProvider ?? null;
      await tx.insert(clientNotes).values({
        clientId,
        authorId: userId,
        body: `Payroll: they process their own payroll${provider ? ` (${provider})` : ""} - we download and enter the reports.`,
      });
    }

    // 3. Contacts and links.
    //    J1 (C4/C5): picker-linked entries (contactId) link the existing
    //    row; otherwise a normalized name+email match links it too (email
    //    must be present - name-only matches create new, safer than fuzzy).
    //    Only genuinely new people insert a contacts row.
    let contactsCreated = 0;
    let contactsLinked = 0;
    // I1: the screen-1 main contact is unshifted first in the contacts array;
    // the FIRST primary_contact wins the client slot, not the last.
    let primaryLinked = false;
    let cpaLinked = false;
    for (const c of form.contacts ?? []) {
      const displayName =
        (c.entityName?.trim() ?? "") !== ""
          ? c.entityName!.trim()
          : [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
      const linkedRow =
        c.contactId != null
          ? await findContactById(tx, c.contactId)
          : await findContactByNameEmail(tx, displayName, c.email);
      const contact =
        linkedRow ??
        (
          await tx
            .insert(contacts)
            .values({
              type: c.entityName ? ("entity" as const) : ("individual" as const),
              firstName: c.firstName ?? null,
              lastName: c.lastName ?? null,
              entityName: c.entityName ?? null,
              email: c.email ?? null,
              phone: c.phone ?? null,
            })
            .returning()
        )[0];
      if (linkedRow) contactsLinked += 1;
      else contactsCreated += 1;
      // K8 (B4): the role may be any contact_roles label - fold it onto the
      // enum for logic and keep the firm's wording in role_label.
      const roleRaw = (c.relationshipType ?? "").trim();
      const roleFold = roleRaw.toLowerCase();
      const relationshipType = c.isPrimary
        ? ("primary_contact" as const)
        : roleFold === "primary_contact" || roleFold === "primary contact"
          ? ("primary_contact" as const)
          : roleFold === "cpa"
            ? ("cpa" as const)
            : ("related" as const);
      const roleLabel =
        relationshipType === "related" && roleFold !== "" && roleFold !== "related" && roleFold !== "other"
          ? roleRaw
          : null;
      await tx
        .insert(contactClientLinks)
        .values({
          contactId: contact.id,
          clientId,
          relationshipType,
          roleLabel,
        })
        .onConflictDoNothing();
      if (relationshipType === "primary_contact" && !primaryLinked) {
        await tx.update(clients).set({ primaryContactId: contact.id }).where(sql`${clients.id} = ${clientId}`);
        primaryLinked = true;
      }
      if (relationshipType === "cpa") {
        await tx.update(clients).set({ cpaContactId: contact.id }).where(sql`${clients.id} = ${clientId}`);
        cpaLinked = true;
      }
    }

    // 3b. I1 (00:30:14): the dedicated CPA card - "Do they have a CPA who
    //     files their taxes?" - links or creates the CPA contact + link when
    //     the contacts list didn't already carry one. J1 (C6): a picker
    //     selection (cpaContactId) or a name+email match links the existing
    //     CPA record instead of spawning "two Yes Taxes LLCs".
    if (form.hasCpa === true && !cpaLinked) {
      const cpaName = typeof form.cpaName === "string" ? form.cpaName.trim() : "";
      const cpaEmail =
        typeof form.cpaEmail === "string" && form.cpaEmail.trim() !== "" ? form.cpaEmail.trim() : null;
      const linkedRow =
        form.cpaContactId != null
          ? await findContactById(tx, form.cpaContactId)
          : cpaName !== ""
            ? await findContactByNameEmail(tx, cpaName, cpaEmail)
            : null;
      if (linkedRow) {
        contactsLinked += 1;
        await tx
          .insert(contactClientLinks)
          .values({ contactId: linkedRow.id, clientId, relationshipType: "cpa" })
          .onConflictDoNothing();
        await tx.update(clients).set({ cpaContactId: linkedRow.id }).where(sql`${clients.id} = ${clientId}`);
      } else if (cpaName !== "") {
        const { firstName, lastName } = splitName(cpaName);
        const [contact] = await tx
          .insert(contacts)
          .values({
            type: "individual",
            firstName,
            lastName,
            email: cpaEmail,
          })
          .returning();
        contactsCreated += 1;
        await tx.insert(contactClientLinks).values({
          contactId: contact.id,
          clientId,
          relationshipType: "cpa",
        });
        await tx.update(clients).set({ cpaContactId: contact.id }).where(sql`${clients.id} = ${clientId}`);
      }
    }

    // 4. Owners (intake_owners rows win; form_data owners are the fallback).
    //    I1: the table has no phone/receives-reports columns, so those fields
    //    merge in from the form_data copy by owner name. I6: receivesReports
    //    lands on the new link column (default true - an unchecked box in a
    //    legacy intake means "not captured", never "opted out").
    let ownerLinksCreated = 0;
    const ownerRows = await tx
      .select()
      .from(intakeOwners)
      .where(sql`${intakeOwners.intakeId} = ${intakeId}`);
    const formOwnersByName = new Map(
      (form.owners ?? []).map((o) => [o.name.trim().toLowerCase(), o]),
    );
    const owners =
      ownerRows.length > 0
        ? ownerRows.map((o) => ({
            id: o.id,
            name: o.name,
            email: o.email,
            ownershipPercent: o.ownershipPercent,
            phone: formOwnersByName.get(o.name.trim().toLowerCase())?.phone ?? null,
            receivesReports:
              formOwnersByName.get(o.name.trim().toLowerCase())?.receivesReports ?? true,
            contactId: formOwnersByName.get(o.name.trim().toLowerCase())?.contactId ?? null,
          }))
        : (form.owners ?? []).map((o) => ({
            id: null as number | null,
            name: o.name,
            email: o.email ?? null,
            ownershipPercent: o.ownershipPercent == null ? null : String(o.ownershipPercent),
            phone: o.phone ?? null,
            receivesReports: o.receivesReports ?? true,
            contactId: o.contactId ?? null,
          }));
    for (const owner of owners) {
      // J1 (C4): an owner who is already on file - or was just created as
      // the primary contact in this same conversion (the C1 same-as-primary
      // shortcut) - LINKS the existing record with the owner role instead
      // of duplicating the person. Name+email both required to match.
      // K4 (B6): a picker-linked owner (contactId set) links THAT record
      // directly; name+email matching stays the fallback.
      const linkedRow =
        owner.contactId != null
          ? (
              await tx
                .select()
                .from(contacts)
                .where(sql`${contacts.id} = ${owner.contactId}`)
                .limit(1)
            )[0] ?? (await findContactByNameEmail(tx, owner.name, owner.email))
          : await findContactByNameEmail(tx, owner.name, owner.email);
      const contact =
        linkedRow ??
        (
          await tx
            .insert(contacts)
            .values({ type: "individual", ...splitName(owner.name), email: owner.email, phone: owner.phone })
            .returning()
        )[0];
      if (linkedRow) contactsLinked += 1;
      else contactsCreated += 1;
      await tx
        .insert(contactClientLinks)
        .values({
          contactId: contact.id,
          clientId,
          relationshipType: "owner",
          ownershipPercent: owner.ownershipPercent,
          receivesReports: owner.receivesReports,
        })
        .onConflictDoNothing();
      ownerLinksCreated += 1;
      if (owner.id != null) {
        await tx
          .update(intakeOwners)
          .set({ contactId: contact.id })
          .where(sql`${intakeOwners.id} = ${owner.id}`);
      }
    }

    // 5. Accounts: intake answers + merchant accounts + default seeds,
    //    with pre-conversion overrides applied by account name (§6.8).
    //    I3: the statement day derives from the account's proof category
    //    (statement -> type default/month-end; owner-declared and
    //    bill-of-sale -> none, out of the queues), the institution FK links
    //    the dropdown pick, and the text snapshot falls back to the FK's
    //    name so vault slots and SOP linking keep working.
    //    J1 (D1/D2/D6): accounts.last4 stamps the masked capture (app-layer
    //    4-digit check via normalizeLast4); loan lenders resolve through the
    //    same institution fields (lenderInstitutionId FK + lender text
    //    snapshot - owner-declared write-ins land in the text snapshot only,
    //    NEVER the institutions table); vault slot labels render the bank ->
    //    type -> last4 standard via accountLabel.
    const overrides = form.accountOverrides ?? {};
    const institutionIds = [
      ...new Set(
        (form.accounts ?? [])
          .flatMap((a) => [a.institutionId, a.lenderInstitutionId])
          .filter((id): id is number => id != null),
      ),
    ];
    const institutionNames = new Map<number, string>();
    if (institutionIds.length > 0) {
      const rows = await tx
        .select({ id: institutions.id, name: institutions.name })
        .from(institutions)
        .where(inArray(institutions.id, institutionIds));
      for (const r of rows) institutionNames.set(r.id, r.name);
    }
    // The account's institution text snapshot + FK: bank fields win; a loan's
    // lender (picked or written in) is the loan row's institution.
    const institutionTextOf = (a: IntakeAccountInput): string | null =>
      a.institution ??
      a.lender ??
      (a.institutionId != null ? (institutionNames.get(a.institutionId) ?? null) : null) ??
      (a.lenderInstitutionId != null ? (institutionNames.get(a.lenderInstitutionId) ?? null) : null);
    const institutionIdOf = (a: IntakeAccountInput): number | null =>
      a.institutionId ?? a.lenderInstitutionId ?? null;
    let accountsCreated = 0;
    const insertedAccounts: (typeof accounts.$inferSelect)[] = [];
    for (const a of form.accounts ?? []) {
      const override = overrides[a.name] ?? {};
      const statementDay =
        a.statementDay !== undefined
          ? a.statementDay
          : override.statementDay !== undefined
            ? override.statementDay
            : statementDayForIntakeAccount(a);
      const [insertedAccount] = await tx
        .insert(accounts)
        .values({
          clientId,
          name: a.name,
          accountType: a.accountType.trim().toLowerCase(),
          institution: institutionTextOf(a),
          institutionId: institutionIdOf(a),
          // J1 (D1): the masked last-4 - app-layer checked (exactly 4 digits),
          // null for legacy/extraction rows that never captured it.
          last4: normalizeLast4(a.last4),
          proofCategory: proofCategoryFor(a),
          statementDay,
          openDate: a.openDate ?? intake.bookkeepingStartDate,
          requiresManualTransactions:
            override.requiresManualTransactions ?? a.requiresManualTransactions ?? false,
        })
        .returning();
      insertedAccounts.push(insertedAccount);
      accountsCreated += 1;
    }
    // K7 (C3, 09_30 00:17:55-00:19:49): evidence-driven onboarding tasks -
    // a bill-of-sale entry requests the purchase document; an owner-declared
    // entry asks the owner for the value. "It would always create some kind
    // of task. It just depends on what it is."
    for (const a of form.accounts ?? []) {
      const label = a.name ?? `${a.accountType ?? "account"}`;
      const followUp =
        a.proofCategory === "bill_of_sale"
          ? {
              title: `Request the bill of sale: ${label}`,
              description:
                "Proof: bill of sale (chosen at intake). Ask the client for the purchase document so the asset lands on the books at its real value.",
            }
          : a.proofCategory === "owner_declared"
            ? {
                title: `Collect the owner's numbers: ${label}`,
                description:
                  "Owner-declared at intake - get the value/balance straight from the owner (what's the value? what's owed?).",
              }
            : null;
      if (!followUp) continue;
      await tx.insert(tasks).values({
        clientId,
        title: followUp.title,
        description: followUp.description,
        taskType: "onboarding",
        status: "new",
        dueDate: formatLocalDate(addDays(today, 7)),
        assigneeId: managerId ?? null,
      });
    }

    // §29 fix: every merchant account becomes its own row with all fields
    // kept; multi-merchant arrays never collapse to a single value.
    // J1 (E4/DB1): the processor picks from merchant_processors - the name
    // snapshot rides `processor`; the id resolves the name when absent.
    const processorIds = [
      ...new Set(
        (form.merchantAccounts ?? [])
          .map((m) => m.processorId)
          .filter((id): id is number => id != null),
      ),
    ];
    const processorNames = new Map<number, string>();
    if (processorIds.length > 0) {
      const rows = await tx
        .select({ id: merchantProcessors.id, name: merchantProcessors.name })
        .from(merchantProcessors)
        .where(inArray(merchantProcessors.id, processorIds));
      for (const r of rows) processorNames.set(r.id, r.name);
    }
    for (const m of form.merchantAccounts ?? []) {
      const [merchantAccount] = await tx
        .insert(accounts)
        .values({
          clientId,
          name: m.name,
          accountType: "merchant",
          // SCHEMA GAP: accounts has no merchant_processor column (only
          // properties.merchantProcessor exists); the processor is preserved
          // in institution until the schema grows one.
          institution: m.processor ?? (m.processorId != null ? (processorNames.get(m.processorId) ?? null) : null),
          statementDay: defaultStatementDayFor("merchant"),
          openDate: intake.bookkeepingStartDate,
        })
        .returning();
      insertedAccounts.push(merchantAccount);
      accountsCreated += 1;
    }
    const seededAccounts = await seedDefaultAccounts(clientId, { openDate: intake.bookkeepingStartDate }, tx as DbOrTx);
    insertedAccounts.push(...seededAccounts);
    accountsCreated += seededAccounts.length;

    // 5c. Expected credential slots (Phase 3B, owner call 01:18:40): every
    //     intake account flagged "grant us login access" opens an unfilled
    //     vault slot linked to its chart-side account. Inside the transaction
    //     so slots roll back with a failed conversion.
    const expectedSlots = (form.accounts ?? [])
      .filter((a) => a.grantLoginAccess === true)
      .map((a) => ({
        accountId: insertedAccounts.find((ia) => ia.name === a.name)?.id ?? null,
        // J1 (D2): vault slot labels follow the bank -> type -> last4
        // standard; legacy accounts without a last-4 keep the old name.
        label: accountLabel({
          name: a.name,
          institution: institutionTextOf(a),
          accountType: a.accountType,
          last4: a.last4,
        }),
        institution: institutionTextOf(a),
      }));
    const credentialsExpectedCreated = await seedExpectedCredentialSlots(
      tx as DbOrTx,
      clientId,
      expectedSlots,
      userId,
    );

    // 5b. Real-estate properties (owner walkthrough: "Are you real estate
    //     specific? Do you have like 10 properties?"). The intake carries a
    //     count, the property types, and the depreciation buckets to track;
    //     conversion creates exactly `count` rows, cycling the chosen types
    //     across them, and seeds each row's depreciation breakdown with the
    //     toggled buckets as unknown-value entries (§20 known-flag shape).
    //     One-shot by construction: the row lock above plus the
    //     already-converted check mean this block can never run twice for
    //     the same intake.
    let propertiesCreated = 0;
    if (form.isRealEstateClient === true) {
      const count = Math.max(0, Math.floor(Number(form.propertyCount ?? 0) || 0));
      const types = (form.propertyTypes ?? []).filter((t) => typeof t === "string" && t.trim() !== "");
      const tracked = (form.depreciationTracking ?? []).filter((k): k is string =>
        (DEPRECIATION_FIELDS as readonly string[]).includes(k),
      );
      const depreciation: DepreciationBreakdown | null =
        tracked.length > 0
          ? Object.fromEntries(tracked.map((k) => [k, { value: null, known: false }]))
          : null;
      for (let i = 0; i < count; i++) {
        await tx.insert(properties).values({
          clientId,
          name: `Property ${i + 1}`,
          propertyType: types.length > 0 ? types[i % types.length] : null,
          depreciation,
        });
        propertiesCreated += 1;
      }
    }

    // 6. Recurring rules: the four defaults (cadence-aware, §19; B21: minus
    //    the ones unselected in the intake checklist) plus custom intake
    //    rules. Project engagements are skipped entirely (§19).
    //    J3 (R1-R5): an intake carrying form_data.routineSchedule (the
    //    wizard's final screen committed) converts through the scheduler
    //    path instead - every entry becomes a rule with the mapped cadence.
    //    Intakes that never touched the scheduler convert exactly as pre-J3.
    let recurringRulesCreated = 0;
    if (!isProject) {
      const routineSchedule = form.routineSchedule;
      if (routineSchedule != null && Object.keys(routineSchedule).length > 0) {
        recurringRulesCreated = await seedFromRoutineSchedule(
          tx,
          clientId,
          intake,
          form,
          routineSchedule,
          { managerId, bookkeeperId },
          today,
        );
      } else {
      const tierDay = intake.monthlyCloseTier == null ? 15 : Number(intake.monthlyCloseTier);
      const anchorMonth = intake.bookkeepingStartDate
        ? parseLocalDate(intake.bookkeepingStartDate).month
        : 1;
      const schedule = scheduleForCadence(intake.bookkeepingFrequency, anchorMonth);
      const excludedDefaults = new Set((form.excludedDefaultRules ?? []).map((k) => String(k)));
      // J2 (E1-E3): the mandatory explanation note captured when a
      // money-behavior card was answered yes rides the seeded task's
      // description, so the review/confirmation work carries the context.
      const behaviorNote = (questionId: string): string | null => {
        const n = form.behaviorNotes?.[questionId];
        return typeof n === "string" && n.trim() !== ""
          ? `Client context from intake: ${n.trim()}`
          : null;
      };
      for (const spec of defaultRuleSpecs(Number.isNaN(tierDay) ? 15 : tierDay, excludedDefaults)) {
        const nextRun = initialNextRun(
          {
            schedule_type: schedule.scheduleType,
            day_of_month: spec.dayOfMonth,
            anchor_month: schedule.anchorMonth,
            next_run: intake.bookkeepingStartDate ?? formatLocalDate(today),
          },
          intake.bookkeepingStartDate,
          today,
        );
        await tx.insert(recurringTasks).values({
          clientId,
          title: spec.title,
          // J2 (R6): the preliminary-reports choice notes itself on the
          // Send Reports rule - the person sending the package sees it
          // where the work happens.
          description:
            spec.key === "send_reports" && form.sendPreliminaryReports === true
              ? PRELIMINARY_REPORTS_NOTE
              : null,
          scheduleType: schedule.scheduleType,
          dayOfMonth: spec.dayOfMonth,
          anchorMonth: schedule.anchorMonth,
          nextRun,
          assigneeId: spec.assignee === "manager" ? managerId : bookkeeperId,
        });
        recurringRulesCreated += 1;
      }

      // K5 (E9, 09_30 00:59:13): the annual tax-readiness checklist seeds for
      // EVERY bookkeeping client on the legacy cadence path too - due the
      // month after year-end (Jan 31 for calendar filers; the month after
      // the fiscal year-end otherwise), with the checklist as subtasks.
      {
        const fiscal = typeof form.fiscalYearEnd === "string" ? form.fiscalYearEnd : null;
        const fiscalMonth = fiscal && /^\d{2}-\d{2}$/.test(fiscal) ? Number(fiscal.slice(0, 2)) : null;
        const anchorMonth = fiscalMonth != null ? (fiscalMonth % 12) + 1 : 1;
        const [eoyRule] = await tx
          .insert(recurringTasks)
          .values({
            clientId,
            title: EOY_TAX_CHECKLIST_TITLE,
            description: EOY_TAX_CHECKLIST_ITEMS.join("\n"),
            scheduleType: "annual",
            anchorMonth,
            dayOfMonth: 31,
            nextRun: initialNextRun(
              {
                schedule_type: "annual",
                day_of_month: 31,
                anchor_month: anchorMonth,
                next_run: intake.bookkeepingStartDate ?? formatLocalDate(today),
              },
              intake.bookkeepingStartDate,
              today,
            ),
            assigneeId: managerId,
          })
          .returning();
        await tx.insert(recurringTaskSubtasks).values(
          EOY_TAX_CHECKLIST_ITEMS.map((title, position) => ({
            recurringTaskId: eoyRule.id,
            title,
            position,
          })),
        );
        recurringRulesCreated += 1;
      }

      // B18 (01:04:29): a personal card used for business needs a monthly
      // chase for the breakdown - seeded like any other default rule.
      if (form.personalCardForBusiness === true) {
        const nextRun = initialNextRun(
          {
            schedule_type: "monthly",
            day_of_month: PERSONAL_CARD_REMINDER_DAY,
            next_run: intake.bookkeepingStartDate ?? formatLocalDate(today),
          },
          intake.bookkeepingStartDate,
          today,
        );
        await tx.insert(recurringTasks).values({
          clientId,
          title: PERSONAL_CARD_REMINDER_TITLE,
          description: behaviorNote("personal-card"),
          scheduleType: "monthly",
          dayOfMonth: PERSONAL_CARD_REMINDER_DAY,
          nextRun,
          assigneeId: bookkeeperId,
        });
        recurringRulesCreated += 1;
      }

      // A41 (00:48:07): money behaving like owner money gets its own monthly
      // review on the close cadence - non-business deposits are booked as
      // owner contributions, never as income. Seeded like the B18 reminder.
      if (form.depositsNonBusiness === true) {
        const nextRun = initialNextRun(
          {
            schedule_type: "monthly",
            day_of_month: Number.isNaN(tierDay) ? 15 : tierDay,
            next_run: intake.bookkeepingStartDate ?? formatLocalDate(today),
          },
          intake.bookkeepingStartDate,
          today,
        );
        await tx.insert(recurringTasks).values({
          clientId,
          title: NON_BUSINESS_DEPOSITS_REVIEW_TITLE,
          description: behaviorNote("deposits-non-business"),
          scheduleType: "monthly",
          dayOfMonth: Number.isNaN(tierDay) ? 15 : tierDay,
          nextRun,
          assigneeId: bookkeeperId,
        });
        recurringRulesCreated += 1;
      }

      // A41 (00:48:07): personal spend on business accounts needs the owner
      // draws confirmed with the client every month on the close cadence.
      if (form.personalOnBusiness === true) {
        const nextRun = initialNextRun(
          {
            schedule_type: "monthly",
            day_of_month: Number.isNaN(tierDay) ? 15 : tierDay,
            next_run: intake.bookkeepingStartDate ?? formatLocalDate(today),
          },
          intake.bookkeepingStartDate,
          today,
        );
        await tx.insert(recurringTasks).values({
          clientId,
          title: OWNER_DRAWS_CONFIRMATION_TITLE,
          description: behaviorNote("personal-on-business"),
          scheduleType: "monthly",
          dayOfMonth: Number.isNaN(tierDay) ? 15 : tierDay,
          nextRun,
          assigneeId: bookkeeperId,
        });
        recurringRulesCreated += 1;
      }

      // I6 (logic map): the merchant-recon "yes" answer is more than billing -
      // the monthly merchant reconciliation task seeds here on the close
      // cadence, next to the other monthly close work.
      if (form.includeMerchantReconciliation === true) {
        const nextRun = initialNextRun(
          {
            schedule_type: schedule.scheduleType,
            day_of_month: Number.isNaN(tierDay) ? 15 : tierDay,
            anchor_month: schedule.anchorMonth,
            next_run: intake.bookkeepingStartDate ?? formatLocalDate(today),
          },
          intake.bookkeepingStartDate,
          today,
        );
        await tx.insert(recurringTasks).values({
          clientId,
          title: MERCHANT_RECONCILIATION_TITLE,
          scheduleType: schedule.scheduleType,
          dayOfMonth: Number.isNaN(tierDay) ? 15 : tierDay,
          anchorMonth: schedule.anchorMonth,
          nextRun,
          assigneeId: bookkeeperId,
        });
        recurringRulesCreated += 1;
      }

      // C10: specialty report definitions recur as their own rules (on the
      // report's cadence, not the client's close cadence) so the work shows
      // up in the queue; pricing rides the services template via the quote.
      const specialtyRules: IntakeCustomRuleInput[] = reportDefinitionsOf(intake).map((def) => ({
        title: def.name,
        description: def.dataSource ?? null,
        ...scheduleForCadence(def.frequency, anchorMonth),
      }));
      if (specialtyRules.length > 0) {
        recurringRulesCreated += await insertCustomRules(
          tx,
          clientId,
          specialtyRules,
          { managerId, bookkeeperId },
          intake.bookkeepingStartDate,
          today,
        );
      }

      const customRules =
        (intake.customRecurringRules as IntakeCustomRuleInput[] | null) ?? form.customRecurringRules ?? [];
      recurringRulesCreated += await insertCustomRules(
        tx,
        clientId,
        customRules,
        { managerId, bookkeeperId },
        intake.bookkeepingStartDate,
        today,
      );
      }
    }

    // 7. Onboarding tasks from the active template rows (§19): admin-phase
    //    tasks start new; the rest start blocked until the admin phase
    //    completes. Template rows marked requires_online_accounts (bank
    //    sync/feed verification) are skipped when no account can connect:
    //    an account has online access when it is not flagged for manual
    //    transaction downloads and it is a statement-producing type
    //    (owner-documented equity/related-party accounts never connect).
    const hasOnlineAccounts = insertedAccounts.some(
      (a) => !a.requiresManualTransactions && a.statementDay != null,
    );
    const templateRows = await tx
      .select()
      .from(onboardingTemplateTasks)
      .where(sql`${onboardingTemplateTasks.isActive} = true`)
      .orderBy(onboardingTemplateTasks.position);
    let onboardingTasksCreated = 0;
    for (const row of templateRows) {
      if (row.requiresOnlineAccounts && !hasOnlineAccounts) continue;
      // Onboarding work belongs to the current work period: stamp a due date
      // and attributed period so queue bucketing (workPeriodForRow) never
      // sees a period-less task.
      const period = workPeriodForDue(today);
      await tx.insert(tasks).values({
        clientId,
        title: row.title,
        description: row.description,
        taskType: "onboarding",
        status: row.isAdminPhase ? "new" : "blocked",
        dueDate: formatLocalDate(today),
        attributedYear: period.year,
        attributedMonth: period.month,
        assigneeId:
          row.defaultAssigneeRole === "manager"
            ? managerId
            : row.defaultAssigneeRole === "bookkeeper"
              ? bookkeeperId
              : null,
      });
      onboardingTasksCreated += 1;
    }

    // 7b. Retroactive catch-up projects (§20, owner walkthrough): when the
    //     intake scopes retroactive bookkeeping, conversion creates ONE
    //     catch-up project per calendar year - never a single merged blob -
    //     each carrying that year's per-account monthly-grid tasks, exactly
    //     the shape createProject's catch-up generator produces.
    let catchUpProjectsCreated = 0;
    if ((form.serviceKeys ?? []).includes("retroactive_bookkeeping") && intake.bookkeepingStartDate) {
      const ranges = catchUpRangesFor(parseLocalDate(intake.bookkeepingStartDate), today);
      const activeAccounts = insertedAccounts.filter((a) => a.isActive);
      for (const range of ranges) {
        const [project] = await tx
          .insert(projects)
          .values({
            clientId,
            name: `Catch-up Bookkeeping ${range.year}`,
            status: "pending",
            billingMode: "project",
            autoGenerateTasks: true,
            createdById: userId,
          })
          .returning();
        if (activeAccounts.length > 0) {
          await tx.insert(projectTasks).values(
            activeAccounts.map((account, position) => ({
              projectId: project.id,
              title: `${account.name} - ${range.year} catch-up`,
              taskKind: "time_period" as const,
              position,
            })),
          );
        }
        catchUpProjectsCreated += 1;
      }
    }

    // 8. Report tracking rows for the current year, from the intake's
    //    report definitions (§6.3). Catch-up periods are floored at the
    //    catch-up date (§32) so a freshly converted client never shows a
    //    wall of instantly-overdue reports dated months in the past.
    let reportRowsCreated = 0;
    if (!isProject) {
      const tier = ((): 5 | 10 | 15 => {
        const n = intake.monthlyCloseTier == null ? 15 : Number(intake.monthlyCloseTier);
        return n === 5 || n === 10 ? n : 15;
      })();
      const catchup = intake.bankFeedCatchupDate ? parseLocalDate(intake.bankFeedCatchupDate) : null;
      const start: Month | null = intake.bookkeepingStartDate
        ? parseLocalDate(intake.bookkeepingStartDate)
        : null;
      for (const def of reportDefinitionsOf(intake)) {
        for (const month of reportMonthsForFrequency(def.frequency)) {
          if (start && (today.year < start.year || (today.year === start.year && month < start.month))) {
            continue;
          }
          const due = effectiveDueDate(closeTierDueDate({ year: today.year, month }, tier), {
            catchupDate: catchup,
          });
          const inserted = await tx
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
          reportRowsCreated += inserted.length;
        }
      }
    }

    // 9. Link the intake and stamp converted_at - same transaction. Any
    //    pre-conversion correspondence (the quote mail) joins the client's
    //    history here so the record reads continuously (correspondence hub).
    await tx
      .update(correspondence)
      .set({ clientId })
      .where(sql`${correspondence.intakeId} = ${intakeId} and ${correspondence.clientId} is null`);
    await tx
      .update(clientIntakes)
      .set({
        clientId,
        status: "completed",
        convertedAt: new Date(),
        managerId,
        bookkeeperId,
        updatedAt: new Date(),
      })
      .where(sql`${clientIntakes.id} = ${intakeId}`);

    return {
      clientId,
      isProject,
      contactsCreated,
      contactsLinked,
      ownerLinksCreated,
      accountsCreated,
      propertiesCreated,
      recurringRulesCreated,
      onboardingTasksCreated,
      catchUpProjectsCreated,
      reportRowsCreated,
      credentialsExpectedCreated,
    };
  });

  // Post-commit: the current year's recurring task instances plus the
  // operational rows (bank feeds, reconciliations) via the existing engine
  // paths. Idempotent; a failure converges on the next daily run.
  let tasksGenerated: number | null = null;
  if (!result.isProject) {
    try {
      const recurring = await runRecurringOnce(today);
      await materializeOperationalRows(today);
      tasksGenerated = recurring.tasksCreated;
    } catch (err) {
      console.error(`[convert] post-conversion generation failed for client ${result.clientId}:`, err);
    }
  }

  // Institution-keyed SOP auto-linking (call notes): accounts with an
  // institution pull their matching SOPs into the client manual + rules.
  try {
    await autoLinkInstitutionSops(result.clientId, userId);
  } catch (err) {
    console.error(`[convert] SOP auto-link failed for client ${result.clientId}:`, err);
  }

  // Correspondence hub (walkthrough 02:28:57): auto-send the welcome /
  // portal-setup mail when a portal contact exists. Respects the portal kill
  // switch inside sendWelcomeEmail; a failure is logged, never rolled back.
  let welcomeEmailSent = false;
  try {
    welcomeEmailSent = (await sendWelcomeEmail(result.clientId, userId)).sent;
  } catch (err) {
    console.error(`[convert] welcome email failed for client ${result.clientId}:`, err);
  }

  return {
    intakeId,
    clientId: result.clientId,
    isProjectEngagement: result.isProject,
    contactsCreated: result.contactsCreated,
    contactsLinked: result.contactsLinked,
    ownerLinksCreated: result.ownerLinksCreated,
    accountsCreated: result.accountsCreated,
    propertiesCreated: result.propertiesCreated,
    recurringRulesCreated: result.recurringRulesCreated,
    onboardingTasksCreated: result.onboardingTasksCreated,
    catchUpProjectsCreated: result.catchUpProjectsCreated,
    reportRowsCreated: result.reportRowsCreated,
    credentialsExpectedCreated: result.credentialsExpectedCreated,
    tasksGenerated,
    welcomeEmailSent,
  };
}
