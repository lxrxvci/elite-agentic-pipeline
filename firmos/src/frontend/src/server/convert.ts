import { sql } from "drizzle-orm";
import {
  closeTierDueDate,
  compareLocalDate,
  formatLocalDate,
  nextRunFrom,
  parseLocalDate,
  reportMonthsForFrequency,
  workPeriodForDue,
  type LocalDate,
  type Month,
} from "@firmos/domain";

import { db } from "@/db";
import {
  accounts,
  clientIntakes,
  clientNotes,
  clientReports,
  clients,
  contactClientLinks,
  contacts,
  intakeOwners,
  onboardingTemplateTasks,
  properties,
  recurringTasks,
  recurringTaskSubtasks,
  tasks,
} from "@/db/schema";
import { DEPRECIATION_FIELDS, type DepreciationBreakdown } from "@/shared/lib/proforma";

import { defaultStatementDayFor, seedDefaultAccounts, type DbOrTx } from "./accounts-seed";
import { autoLinkInstitutionSops } from "./templates";
import { localToday } from "./dates";
import {
  assertIntakeTransition,
  type IntakeCustomRuleInput,
  type IntakeFormData,
  type IntakeRow,
} from "./intake";
import { materializeOperationalRows, reportDefinitionsOf } from "./materialize";
import {
  buildRecurringServicesTemplate,
  calculateIntakeQuoteWithConfig,
  quoteAmountStamps,
} from "./quote";
import { runRecurringOnce } from "./recurring";

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
 * custom), onboarding tasks, and report tracking rows; then it links the
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
  ownerLinksCreated: number;
  accountsCreated: number;
  propertiesCreated: number;
  recurringRulesCreated: number;
  onboardingTasksCreated: number;
  reportRowsCreated: number;
  /** null when the post-commit generation pass failed (see header). */
  tasksGenerated: number | null;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function formOf(intake: IntakeRow): IntakeFormData {
  return (intake.formData ?? {}) as IntakeFormData;
}

function splitName(name: string): { firstName: string; lastName: string | null } {
  const parts = name.trim().split(/\s+/);
  return { firstName: parts[0] ?? name.trim(), lastName: parts.length > 1 ? parts.slice(1).join(" ") : null };
}

// ── Recurring rules (§19 defaults, cadence-aware) ─────────────────────────

interface DefaultRuleSpec {
  title: string;
  assignee: "manager" | "bookkeeper";
  dayOfMonth: number;
}

/** The four defaults (§19); tier day is the close-work due day on monthly clients. */
function defaultRuleSpecs(tierDay: number): DefaultRuleSpec[] {
  return [
    { title: "Reconcile Accounts", assignee: "bookkeeper", dayOfMonth: tierDay },
    { title: "Categorize Transactions", assignee: "bookkeeper", dayOfMonth: tierDay },
    { title: "Client Questions", assignee: "manager", dayOfMonth: 25 },
    { title: "Send Reports", assignee: "manager", dayOfMonth: tierDay },
  ];
}

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
    const isProject = (intake.engagementType ?? form.engagementType) === "project";

    // Billing template from the quote (§6.5 price flow, server-side only),
    // priced against the admin-configured table.
    const quote = await calculateIntakeQuoteWithConfig({ ...form, bookkeepingFrequency: intake.bookkeepingFrequency }, today);
    const template = buildRecurringServicesTemplate(quote, form.customItems ?? []);
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

    // 3. Contacts and links.
    let contactsCreated = 0;
    for (const c of form.contacts ?? []) {
      const [contact] = await tx
        .insert(contacts)
        .values({
          type: c.entityName ? ("entity" as const) : ("individual" as const),
          firstName: c.firstName ?? null,
          lastName: c.lastName ?? null,
          entityName: c.entityName ?? null,
          email: c.email ?? null,
          phone: c.phone ?? null,
        })
        .returning();
      contactsCreated += 1;
      const relationshipType = c.isPrimary
        ? ("primary_contact" as const)
        : (c.relationshipType ?? ("related" as const));
      await tx.insert(contactClientLinks).values({
        contactId: contact.id,
        clientId,
        relationshipType,
      });
      if (relationshipType === "primary_contact") {
        await tx.update(clients).set({ primaryContactId: contact.id }).where(sql`${clients.id} = ${clientId}`);
      }
      if (relationshipType === "cpa") {
        await tx.update(clients).set({ cpaContactId: contact.id }).where(sql`${clients.id} = ${clientId}`);
      }
    }

    // 4. Owners (intake_owners rows win; form_data owners are the fallback).
    let ownerLinksCreated = 0;
    const ownerRows = await tx
      .select()
      .from(intakeOwners)
      .where(sql`${intakeOwners.intakeId} = ${intakeId}`);
    const owners =
      ownerRows.length > 0
        ? ownerRows.map((o) => ({ id: o.id, name: o.name, email: o.email, ownershipPercent: o.ownershipPercent }))
        : (form.owners ?? []).map((o) => ({
            id: null as number | null,
            name: o.name,
            email: o.email ?? null,
            ownershipPercent: o.ownershipPercent == null ? null : String(o.ownershipPercent),
          }));
    for (const owner of owners) {
      const { firstName, lastName } = splitName(owner.name);
      const [contact] = await tx
        .insert(contacts)
        .values({ type: "individual", firstName, lastName, email: owner.email })
        .returning();
      contactsCreated += 1;
      await tx.insert(contactClientLinks).values({
        contactId: contact.id,
        clientId,
        relationshipType: "owner",
        ownershipPercent: owner.ownershipPercent,
      });
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
    const overrides = form.accountOverrides ?? {};
    let accountsCreated = 0;
    for (const a of form.accounts ?? []) {
      const override = overrides[a.name] ?? {};
      const statementDay =
        a.statementDay !== undefined
          ? a.statementDay
          : override.statementDay !== undefined
            ? override.statementDay
            : defaultStatementDayFor(a.accountType);
      await tx.insert(accounts).values({
        clientId,
        name: a.name,
        accountType: a.accountType.trim().toLowerCase(),
        institution: a.institution ?? null,
        statementDay,
        openDate: a.openDate ?? intake.bookkeepingStartDate,
        requiresManualTransactions:
          override.requiresManualTransactions ?? a.requiresManualTransactions ?? false,
      });
      accountsCreated += 1;
    }
    // §29 fix: every merchant account becomes its own row with all fields
    // kept; multi-merchant arrays never collapse to a single value.
    for (const m of form.merchantAccounts ?? []) {
      await tx.insert(accounts).values({
        clientId,
        name: m.name,
        accountType: "merchant",
        // SCHEMA GAP: accounts has no merchant_processor column (only
        // properties.merchantProcessor exists); the processor is preserved
        // in institution until the schema grows one.
        institution: m.processor ?? null,
        statementDay: defaultStatementDayFor("merchant"),
        openDate: intake.bookkeepingStartDate,
      });
      accountsCreated += 1;
    }
    accountsCreated += (await seedDefaultAccounts(clientId, { openDate: intake.bookkeepingStartDate }, tx as DbOrTx)).length;

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

    // 6. Recurring rules: the four defaults (cadence-aware, §19) plus custom
    //    intake rules. Project engagements are skipped entirely (§19).
    let recurringRulesCreated = 0;
    if (!isProject) {
      const tierDay = intake.monthlyCloseTier == null ? 15 : Number(intake.monthlyCloseTier);
      const anchorMonth = intake.bookkeepingStartDate
        ? parseLocalDate(intake.bookkeepingStartDate).month
        : 1;
      const schedule = scheduleForCadence(intake.bookkeepingFrequency, anchorMonth);
      for (const spec of defaultRuleSpecs(Number.isNaN(tierDay) ? 15 : tierDay)) {
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
          scheduleType: schedule.scheduleType,
          dayOfMonth: spec.dayOfMonth,
          anchorMonth: schedule.anchorMonth,
          nextRun,
          assigneeId: spec.assignee === "manager" ? managerId : bookkeeperId,
        });
        recurringRulesCreated += 1;
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

    // 7. Onboarding tasks from the active template rows (§19): admin-phase
    //    tasks start new; the rest start blocked until the admin phase
    //    completes.
    const templateRows = await tx
      .select()
      .from(onboardingTemplateTasks)
      .where(sql`${onboardingTemplateTasks.isActive} = true`)
      .orderBy(onboardingTemplateTasks.position);
    for (const row of templateRows) {
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
    }

    // 8. Report tracking rows for the current year, from the intake's
    //    report definitions (§6.3).
    let reportRowsCreated = 0;
    if (!isProject) {
      const tier = ((): 5 | 10 | 15 => {
        const n = intake.monthlyCloseTier == null ? 15 : Number(intake.monthlyCloseTier);
        return n === 5 || n === 10 ? n : 15;
      })();
      const start: Month | null = intake.bookkeepingStartDate
        ? parseLocalDate(intake.bookkeepingStartDate)
        : null;
      for (const def of reportDefinitionsOf(intake)) {
        for (const month of reportMonthsForFrequency(def.frequency)) {
          if (start && (today.year < start.year || (today.year === start.year && month < start.month))) {
            continue;
          }
          const due = closeTierDueDate({ year: today.year, month }, tier);
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

    // 9. Link the intake and stamp converted_at - same transaction.
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
      ownerLinksCreated,
      accountsCreated,
      propertiesCreated,
      recurringRulesCreated,
      onboardingTasksCreated: templateRows.length,
      reportRowsCreated,
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

  return {
    intakeId,
    clientId: result.clientId,
    isProjectEngagement: result.isProject,
    contactsCreated: result.contactsCreated,
    ownerLinksCreated: result.ownerLinksCreated,
    accountsCreated: result.accountsCreated,
    propertiesCreated: result.propertiesCreated,
    recurringRulesCreated: result.recurringRulesCreated,
    onboardingTasksCreated: result.onboardingTasksCreated,
    reportRowsCreated: result.reportRowsCreated,
    tasksGenerated,
  };
}
