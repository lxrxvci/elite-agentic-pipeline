import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import {
  clientNotes,
  clients,
  invoiceLineItems,
  invoices,
  projects,
  quickNotes,
  recurringTasks,
  tasks,
  taskSubtasks,
  users,
  yearEndTaxChecklists,
} from "@/db/schema";
import { convertIntakeToClient, NON_BUSINESS_DEPOSITS_REVIEW_TITLE, OWNER_DRAWS_CONFIRMATION_TITLE, PERSONAL_CARD_REMINDER_TITLE } from "@/server/convert";
import {
  createIntake,
  getIntake,
  submitIntakeForReview,
  updateIntake,
  type IntakeFormData,
  type IntakePatch,
} from "@/server/intake";
import { generateMonthlyInvoices } from "@/server/invoices";
import { updateProjectBilling } from "@/server/projects";
import {
  addQuickNote,
  createTaskFromNote,
  listQuickNotes,
  setQuickNoteCompleted,
  QuickAddError,
} from "@/server/quick-add";
import {
  buildRecurringServicesTemplate,
  calculateIntakeQuote,
  calculateIntakeQuoteWithConfig,
  type TemplateLineItem,
} from "@/server/quote";
import { seedDatabase } from "@/server/seed";
import { getOrCreateClientChecklist } from "@/server/tax";
import { createOnboardingTemplate, updateOnboardingTemplate } from "@/server/templates";
import { completeTask, SubtasksIncompleteError } from "@/server/work-items";

import { dbReachable, TEST_TODAY } from "./helpers";

/**
 * The 2026-09-23 "money & intake completeness" batch (FIRMOS-TRANSCRIPT-AUDIT
 * items C1-follow-through, C10, C15, C16, B4, B18, B21, E4, E11): each test
 * pins one client requirement from the recorded walkthrough end to end at the
 * server layer. UI pins live next to the components; the pure pricing math
 * lives in packages/domain/test/quote.test.ts.
 */

vi.mock("@/server/auth/guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/guards")>();
  return {
    ...actual,
    requireStaff: vi.fn(async () => undefined),
    requireRole: vi.fn(async () => undefined),
  };
});

const reachable = await dbReachable();

async function userIdByEmail(email: string): Promise<number> {
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return row.id;
}

/** Create + submit an intake ready for conversion (convert.test.ts convention). */
async function reviewableIntake(patch: IntakePatch): Promise<number> {
  const row = await createIntake(patch);
  await updateIntake(row.id, {});
  await submitIntakeForReview(row.id);
  return row.id;
}

async function invoicesFor(clientId: number) {
  return db.select().from(invoices).where(eq(invoices.clientId, clientId));
}

describe.skipIf(!reachable)("money & intake completeness batch (server layer)", () => {
  let ownerId: number;
  let bookkeeperId: number;

  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    ownerId = await userIdByEmail("mara@blueledgerbooks.com");
    bookkeeperId = await userIdByEmail("sofia@blueledgerbooks.com");
  });

  // Item 1 (C1 follow-through): a per-service discount captured in the intake
  // rides form_data through conversion into the billing template, and the
  // monthly invoice bills the discounted net.
  it("discount_capture_flows_intake_to_template_to_invoice", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Discount Capture Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "15",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        accounts: [{ name: "Operating", accountType: "checking", institution: "Chase", last4: "4411" }],
        serviceDiscounts: { bank_feed_management: 25 },
      },
    });

    // The intake quote is already net of the discount (server-side pricing).
    const intake = await getIntake(intakeId);
    const quote = await calculateIntakeQuoteWithConfig((intake.formData ?? {}) as IntakeFormData, TEST_TODAY);
    expect(quote.totals.effectiveMonthly).toBe(75);

    const result = await convertIntakeToClient(intakeId, {}, ownerId, TEST_TODAY);
    const [client] = await db.select().from(clients).where(eq(clients.id, result.clientId));
    const template = client.recurringServicesTemplate as TemplateLineItem[];
    const line = template.find((l) => l.service_key === "bank_feed_management");
    expect(line?.discount).toBe(25);

    await generateMonthlyInvoices(2026, 8, TEST_TODAY);
    const [invoice] = await invoicesFor(client.id);
    expect(invoice.total).toBe("75.00");
  });

  // Item 4 (C10): specialty report definitions price into the quote (hours x
  // default rate, flat price wins), the missed-filings count adds a one-time
  // retro line, and conversion creates the recurring report rules.
  it("specialty_reports_price_and_recur_with_retro_filings", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Specialty Reports Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "15",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"], // $100/mo
        accounts: [{ name: "Operating", accountType: "checking", institution: "Chase", last4: "4411" }],
        // The wizard writes reportDefinitions to BOTH the column and
        // form_data (buildPatch); mirror that here so the quote sees them.
        reportDefinitions: [
          // $450/mo (3h x $150) - the walkthrough's exact specialty figure.
          { name: "Owner Draw Analysis", frequency: "monthly", estimatedHours: 3 },
          // $200/report annually, plus 18 unfiled past reports one-time.
          {
            name: "Oregon Special Report",
            frequency: "annual",
            dataSource: "Client portal upload",
            flatPrice: 200,
            missedFilings: 18,
          },
        ],
      },
      reportDefinitions: [
        { name: "Owner Draw Analysis", frequency: "monthly", estimatedHours: 3 },
        {
          name: "Oregon Special Report",
          frequency: "annual",
          dataSource: "Client portal upload",
          flatPrice: 200,
          missedFilings: 18,
        },
      ],
    });

    const intake = await getIntake(intakeId);
    const quote = await calculateIntakeQuoteWithConfig((intake.formData ?? {}) as IntakeFormData, TEST_TODAY);
    const byKey = new Map(quote.lines.map((l) => [l.service_key, l]));
    expect(byKey.get("specialty_report_1")).toMatchObject({
      product_name: "Specialty Report: Owner Draw Analysis",
      unit_price: 450,
      quantity: 1,
      bucket: "monthly",
    });
    expect(byKey.get("specialty_report_2")).toMatchObject({ unit_price: 200, bucket: "monthly" });
    const retro = byKey.get("specialty_report_2_retro");
    expect(retro).toMatchObject({
      product_name: "Missed past filings: Oregon Special Report",
      quantity: 18,
      unit_price: 200,
      amount: 3600,
      bucket: "one_time",
    });
    // effective monthly: 100 + 450 + 200/12 (16.67 per-line rounding).
    expect(quote.totals.effectiveMonthly).toBe(566.67);
    expect(quote.totals.totalOneTime).toBe(3600);

    const result = await convertIntakeToClient(intakeId, { bookkeeperId }, ownerId, TEST_TODAY);

    // Template lines: the report's OWN frequency + the one-time retro line.
    const [client] = await db.select().from(clients).where(eq(clients.id, result.clientId));
    const template = client.recurringServicesTemplate as TemplateLineItem[];
    const monthlyLine = template.find((l) => l.service_key === "specialty_report_1");
    expect(monthlyLine).toMatchObject({ frequency: "monthly", unit_price: 450 });
    const annualLine = template.find((l) => l.service_key === "specialty_report_2");
    expect(annualLine).toMatchObject({ frequency: "annual", unit_price: 200 });
    const retroLine = template.find((l) => l.service_key === "specialty_report_2_retro");
    expect(retroLine).toMatchObject({ frequency: "one_time", quantity: 18, unit_price: 200 });

    // Both definitions recur as their own rules, cadence-independent.
    const rules = await db
      .select()
      .from(recurringTasks)
      .where(eq(recurringTasks.clientId, client.id));
    const reportRules = rules.filter((r) =>
      ["Oregon Special Report", "Owner Draw Analysis"].includes(r.title),
    );
    expect(reportRules.map((r) => r.title).sort()).toEqual([
      "Oregon Special Report",
      "Owner Draw Analysis",
    ]);
    expect(reportRules.find((r) => r.title === "Oregon Special Report")?.scheduleType).toBe("annual");
    expect(reportRules.find((r) => r.title === "Owner Draw Analysis")?.scheduleType).toBe("monthly");
    // The data-source note rides the rule description.
    expect(reportRules.find((r) => r.title === "Oregon Special Report")?.description).toBe(
      "Client portal upload",
    );

    // The monthly invoice bills the monthly report line at the stored price.
    await generateMonthlyInvoices(2026, 8, TEST_TODAY);
    const [invoice] = await invoicesFor(client.id);
    const lines = await db
      .select()
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, invoice.id));
    const billed = lines.find((l) => l.serviceKey === "specialty_report_1");
    expect(billed).toMatchObject({ unitPrice: "450.00", amount: "450.00" });
    // The one-time retro line never recurs onto an invoice.
    expect(lines.some((l) => l.serviceKey === "specialty_report_2_retro")).toBe(false);
  });

  // Item 4, C9 edge: a report definition with no pricing data stays a
  // tracking row - no quote line, no guessed amount.
  it("specialty_reports_without_pricing_stay_tracking_only", async () => {
    const quote = await calculateIntakeQuoteWithConfig(
      {
        serviceKeys: ["bank_feed_management"],
        reportDefinitions: [{ name: "Monthly Financial Package", frequency: "monthly" }],
      },
      TEST_TODAY,
    );
    expect(quote.lines.some((l) => l.service_key.startsWith("specialty_report_"))).toBe(false);
    expect(quote.totals.effectiveMonthly).toBe(100);
  });

  // Item 5 (B18): "personal credit card used for business = yes/sometimes"
  // seeds the monthly breakdown reminder task at conversion.
  it("personal_card_answer_seeds_the_monthly_reminder_rule", async () => {
    const withCard = await reviewableIntake({
      legalName: "Personal Card Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "15",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        accounts: [{ name: "Operating", accountType: "checking", institution: "Chase", last4: "4411" }],
        personalCardForBusiness: true,
      },
    });
    const result = await convertIntakeToClient(withCard, { bookkeeperId }, ownerId, TEST_TODAY);
    const rules = await db
      .select()
      .from(recurringTasks)
      .where(eq(recurringTasks.clientId, result.clientId));
    const reminder = rules.find((r) => r.title === PERSONAL_CARD_REMINDER_TITLE);
    expect(reminder).toBeDefined();
    expect(reminder).toMatchObject({
      scheduleType: "monthly",
      dayOfMonth: 1,
      assigneeId: bookkeeperId,
    });
    expect((reminder!.nextRun ?? "") >= "2026-08-15").toBe(true); // seeded in the future

    // Control: no personal card, no reminder.
    const withoutCard = await reviewableIntake({
      legalName: "No Personal Card Co",
      bookkeepingFrequency: "monthly",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        accounts: [{ name: "Operating", accountType: "checking", institution: "Chase", last4: "4411" }],
        personalCardForBusiness: false,
      },
    });
    const clean = await convertIntakeToClient(withoutCard, {}, ownerId, TEST_TODAY);
    const cleanRules = await db
      .select()
      .from(recurringTasks)
      .where(eq(recurringTasks.clientId, clean.clientId));
    expect(cleanRules.some((r) => r.title === PERSONAL_CARD_REMINDER_TITLE)).toBe(false);
  });

  // Item 5b (A41, 00:48:07): the two money-behavior yes answers seed their
  // monthly bookkeeper tasks at conversion - owner-contribution review for
  // non-business deposits, owner-draws confirmation for personal spend on
  // business accounts - both on the close cadence (the tier day).
  it("money_behavior_answers_seed_their_monthly_tasks", async () => {
    const flagged = await reviewableIntake({
      legalName: "Money Behavior Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "10",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        accounts: [{ name: "Operating", accountType: "checking", institution: "Chase", last4: "4411" }],
        depositsNonBusiness: true,
        personalOnBusiness: true,
      },
    });
    const result = await convertIntakeToClient(flagged, { bookkeeperId }, ownerId, TEST_TODAY);
    const rules = await db
      .select()
      .from(recurringTasks)
      .where(eq(recurringTasks.clientId, result.clientId));

    const deposits = rules.find((r) => r.title === NON_BUSINESS_DEPOSITS_REVIEW_TITLE);
    expect(deposits).toBeDefined();
    expect(deposits).toMatchObject({
      scheduleType: "monthly",
      dayOfMonth: 10, // the close cadence: this client's tier day
      assigneeId: bookkeeperId,
    });
    expect((deposits!.nextRun ?? "") >= "2026-08-15").toBe(true); // seeded in the future

    const draws = rules.find((r) => r.title === OWNER_DRAWS_CONFIRMATION_TITLE);
    expect(draws).toBeDefined();
    expect(draws).toMatchObject({
      scheduleType: "monthly",
      dayOfMonth: 10,
      assigneeId: bookkeeperId,
    });
    expect((draws!.nextRun ?? "") >= "2026-08-15").toBe(true);

    // Controls: an explicit "no" seeds nothing, and an absent answer seeds
    // nothing (pre-A41 intakes never grew these tasks).
    const declined = await reviewableIntake({
      legalName: "No Money Behavior Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "10",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        accounts: [{ name: "Operating", accountType: "checking", institution: "Chase", last4: "4411" }],
        depositsNonBusiness: false,
        personalOnBusiness: false,
      },
    });
    const declinedResult = await convertIntakeToClient(declined, {}, ownerId, TEST_TODAY);
    const declinedRules = await db
      .select()
      .from(recurringTasks)
      .where(eq(recurringTasks.clientId, declinedResult.clientId));
    expect(declinedRules.some((r) => r.title === NON_BUSINESS_DEPOSITS_REVIEW_TITLE)).toBe(false);
    expect(declinedRules.some((r) => r.title === OWNER_DRAWS_CONFIRMATION_TITLE)).toBe(false);

    const legacy = await reviewableIntake({
      legalName: "Legacy No Behavior Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "10",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        accounts: [{ name: "Operating", accountType: "checking", institution: "Chase", last4: "4411" }],
      },
    });
    const legacyResult = await convertIntakeToClient(legacy, {}, ownerId, TEST_TODAY);
    const legacyRules = await db
      .select()
      .from(recurringTasks)
      .where(eq(recurringTasks.clientId, legacyResult.clientId));
    expect(legacyRules.some((r) => r.title === NON_BUSINESS_DEPOSITS_REVIEW_TITLE)).toBe(false);
    expect(legacyRules.some((r) => r.title === OWNER_DRAWS_CONFIRMATION_TITLE)).toBe(false);
  });

  // Item 6 (B21): the intake checklist unselects default rules; conversion
  // seeds only the selected ones.
  it("default_rules_checklist_unselect_skips_seeding", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Picky Routines Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "15",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        accounts: [{ name: "Operating", accountType: "checking", institution: "Chase", last4: "4411" }],
        excludedDefaultRules: ["client_questions", "send_reports"],
      },
    });
    const result = await convertIntakeToClient(intakeId, {}, ownerId, TEST_TODAY);
    const rules = await db
      .select()
      .from(recurringTasks)
      .where(eq(recurringTasks.clientId, result.clientId));
    const titles = rules.map((r) => r.title);
    expect(titles).toContain("Reconcile Accounts");
    expect(titles).toContain("Categorize Transactions");
    expect(titles).not.toContain("Client Questions");
    expect(titles).not.toContain("Send Reports");
    expect(result.recurringRulesCreated).toBe(3); // 2 remaining + the annual EOY checklist (E9)
  });

  // Item 3 (C15): milestone billing - progress invoices every N months from
  // the project start, and a completion invoice when the project closes.
  it("milestone_billing_progress_and_completion_invoices", async () => {
    const [client] = await db
      .insert(clients)
      .values({
        legalName: "Milestone Co",
        bookkeepingFrequency: "monthly",
        billingFrequency: "monthly",
        monthlyCloseTier: "15",
        bookkeepingStartDate: "2026-01-01",
        monthlyRecurringAmount: "100.00",
      })
      .returning();

    // Progress: started Jan 1, bills $500 every 2 months. At the Aug run the
    // elapsed months are 7 -> floor(7/2) = 3 milestones due.
    const [project] = await db
      .insert(projects)
      .values({
        clientId: client.id,
        name: "System migration",
        status: "in_progress",
        startDate: "2026-01-01",
        milestoneIntervalMonths: 2,
        milestoneAmount: "500.00",
      })
      .returning();

    const summary = await generateMonthlyInvoices(2026, 8, TEST_TODAY);
    expect(summary.milestoneInvoicesCreated).toBeGreaterThanOrEqual(1);

    let projectInvoices = (await invoicesFor(client.id)).filter((i) =>
      i.invoiceNumber?.includes(`-P${project.id}-`),
    );
    expect(projectInvoices).toHaveLength(1);
    expect(projectInvoices[0].total).toBe("1500.00"); // 3 milestones x $500
    expect(projectInvoices[0].isAutoGenerated).toBe(false);
    const progressLines = await db
      .select()
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, projectInvoices[0].id));
    expect(progressLines[0].description).toContain("Progress billing - System migration");
    expect(progressLines[0].quantity).toBe("3.00");

    // Idempotent: a rerun of the same period bills nothing new.
    const rerun = await generateMonthlyInvoices(2026, 8, TEST_TODAY);
    expect(rerun.milestoneInvoicesCreated).toBe(0);
    projectInvoices = (await invoicesFor(client.id)).filter((i) =>
      i.invoiceNumber?.includes(`-P${project.id}-`),
    );
    expect(projectInvoices).toHaveLength(1);

    // Completion: a second project bills its fixed price once when closed.
    const [done] = await db
      .insert(projects)
      .values({
        clientId: client.id,
        name: "Q1 cleanup",
        status: "completed",
        billingMode: "project",
        fixedPrice: "2500.00",
        billOnCompletion: true,
      })
      .returning();
    await generateMonthlyInvoices(2026, 8, TEST_TODAY);
    const completionInvoices = (await invoicesFor(client.id)).filter((i) =>
      i.invoiceNumber?.endsWith(`-C${done.id}`),
    );
    expect(completionInvoices).toHaveLength(1);
    expect(completionInvoices[0].total).toBe("2500.00");
    const completionLines = await db
      .select()
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, completionInvoices[0].id));
    expect(completionLines[0].description).toBe("Project completion - Q1 cleanup");

    // The completion invoice never repeats.
    await generateMonthlyInvoices(2026, 8, TEST_TODAY);
    expect(
      (await invoicesFor(client.id)).filter((i) => i.invoiceNumber?.endsWith(`-C${done.id}`)),
    ).toHaveLength(1);

    // The recurring monthly invoice is untouched by milestone billing.
    const recurring = (await invoicesFor(client.id)).filter((i) => i.isAutoGenerated);
    expect(recurring).toHaveLength(1);
    expect(recurring[0].total).toBe("100.00");
  });

  // Item 3 validation: progress invoicing needs both an interval and an
  // amount, and editing the schedule resets the billed counter.
  it("milestone_config_validates_pairs_and_resets_the_counter", async () => {
    const [client] = await db
      .insert(clients)
      .values({ legalName: "Milestone Validation Co", bookkeepingStartDate: "2026-01-01" })
      .returning();
    const [project] = await db
      .insert(projects)
      .values({ clientId: client.id, name: "Validation project", milestoneIntervalMonths: 3, milestoneAmount: "100.00", milestonesInvoiced: 2 })
      .returning();

    await expect(
      updateProjectBilling(project.id, { milestoneAmount: null }, ownerId),
    ).rejects.toThrow("both an interval and an amount");

    const updated = await updateProjectBilling(
      project.id,
      { milestoneIntervalMonths: 6, milestoneAmount: "750.00" },
      ownerId,
    );
    expect(updated.milestoneIntervalMonths).toBe(6);
    expect(updated.milestoneAmount).toBe("750.00");
    expect(updated.milestonesInvoiced).toBe(0); // schedule change resets
  });

  // Item 7 (B4): a parent task cannot complete while subtasks are open.
  it("subtask_completion_gates_the_parent_task", async () => {
    const [client] = await db
      .insert(clients)
      .values({ legalName: "Gating Co", bookkeepingStartDate: "2026-01-01" })
      .returning();
    const [parent] = await db
      .insert(tasks)
      .values({
        clientId: client.id,
        title: "Collect logins",
        taskType: "ad_hoc",
        status: "new",
        dueDate: "2026-08-20",
        attributedYear: 2026,
        attributedMonth: 8,
      })
      .returning();
    await db.insert(taskSubtasks).values([
      { taskId: parent.id, title: "Chase login", position: 0, isCompleted: true },
      { taskId: parent.id, title: "Stripe login", position: 1 },
    ]);

    // Open subtask -> typed error with the count.
    const err = await completeTask(parent.id, true, ownerId).catch((e) => e);
    expect(err).toBeInstanceOf(SubtasksIncompleteError);
    expect((err as SubtasksIncompleteError).incompleteCount).toBe(1);
    const [stillOpen] = await db.select().from(tasks).where(eq(tasks.id, parent.id));
    expect(stillOpen.status).toBe("new");

    // Complete the checklist, then the parent completes.
    await db
      .update(taskSubtasks)
      .set({ isCompleted: true, completedAt: new Date(), completedById: ownerId })
      .where(eq(taskSubtasks.taskId, parent.id));
    const completed = await completeTask(parent.id, true, ownerId);
    expect(completed.status).toBe("completed");

    // Re-opening is never gated.
    const reopened = await completeTask(parent.id, false, ownerId);
    expect(reopened.status).toBe("open");
  });

  // Item 8 (E11): the payroll/W-2 year-end item populates only for payroll
  // clients.
  it("year_end_checklist_excludes_payroll_items_without_payroll", async () => {
    const [noPayroll] = await db
      .insert(clients)
      .values({ legalName: "No Payroll Co", bookkeepingStartDate: "2026-01-01", hasPayroll: false })
      .returning();
    const items = await getOrCreateClientChecklist(noPayroll.id, 2026);
    expect(items).toHaveLength(11);
    expect(items.some((i) => /payroll|W-2/i.test(i.title))).toBe(false);

    const [withPayroll] = await db
      .insert(clients)
      .values({ legalName: "Payroll Co", bookkeepingStartDate: "2026-01-01", hasPayroll: true })
      .returning();
    const payrollItems = await getOrCreateClientChecklist(withPayroll.id, 2026);
    expect(payrollItems).toHaveLength(12);
    expect(payrollItems.some((i) => i.title === "Reconcile payroll and prepare W-2 information")).toBe(true);
  });

  // Item 8 conversion path: the intake payroll answer stamps the client flag.
  it("conversion_stamps_has_payroll_from_the_intake_answer", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Payroll Flag Co",
      bookkeepingFrequency: "monthly",
      bookkeepingStartDate: "2026-01-01",
      payrollProvider: "Gusto",
      formData: {
        serviceKeys: ["bank_feed_management"],
        accounts: [{ name: "Operating", accountType: "checking", institution: "Chase", last4: "4411" }],
        hasPayroll: true,
      },
    });
    const result = await convertIntakeToClient(intakeId, {}, ownerId, TEST_TODAY);
    const [client] = await db.select().from(clients).where(eq(clients.id, result.clientId));
    expect(client.hasPayroll).toBe(true);
  });

  // Item 9: the onboarding template editor flag round-trips create + update.
  it("onboarding_template_requires_online_accounts_round_trips", async () => {
    const created = await createOnboardingTemplate(ownerId, {
      title: "Verify bank sync status",
      isAdminPhase: false,
      requiresOnlineAccounts: true,
    });
    expect(created.requiresOnlineAccounts).toBe(true);

    // Update preserves the flag when untouched, and can toggle it.
    const renamed = await updateOnboardingTemplate(ownerId, created.id, { title: "Verify bank feed sync" });
    expect(renamed.requiresOnlineAccounts).toBe(true);
    expect(renamed.title).toBe("Verify bank feed sync");
    const toggled = await updateOnboardingTemplate(ownerId, created.id, { requiresOnlineAccounts: false });
    expect(toggled.requiresOnlineAccounts).toBe(false);
  });

  // Item 10 (E4): quick notes carry priority + due date + completion, and a
  // note spins off a prefilled follow-up task that completes the note.
  it("quick_note_priority_due_completion_and_followup_task", async () => {
    const [client] = await db
      .insert(clients)
      .values({ legalName: "Note Followup Co", bookkeepingStartDate: "2026-01-01" })
      .returning();

    const note = await addQuickNote(
      { clientId: client.id, body: "Ask about the missing 1099", priority: "urgent", dueDate: "2026-08-20" },
      ownerId,
    );
    expect(note.priority).toBe("urgent");
    expect(note.dueDate).toBe("2026-08-20");

    // The feed carries the new fields.
    const feed = await listQuickNotes(ownerId);
    const feedItem = feed.find((n) => n.id === note.id);
    expect(feedItem).toMatchObject({ priority: "urgent", dueDate: "2026-08-20", completedAt: null });

    // Validation: bad priority and malformed due date are rejected.
    await expect(
      addQuickNote({ clientId: client.id, body: "x", priority: "critical" as never }, ownerId),
    ).rejects.toThrow(QuickAddError);
    await expect(
      addQuickNote({ clientId: client.id, body: "x", dueDate: "next Friday" }, ownerId),
    ).rejects.toThrow(QuickAddError);

    // Follow-up task: prefills client + title from the note, stamps the note
    // completed when the task lands.
    const { task, note: after } = await createTaskFromNote(note.id, {}, ownerId, TEST_TODAY);
    expect(task.clientId).toBe(client.id);
    expect(task.title).toBe("Ask about the missing 1099");
    expect(task.dueDate).toBe("2026-08-20"); // note due date carries over
    expect(after.completedAt).not.toBeNull();

    // Completion toggling is author-only (same posture as delete).
    const other = await addQuickNote({ body: "mine only" }, ownerId);
    await expect(setQuickNoteCompleted(other.id, true, bookkeeperId)).rejects.toThrow(QuickAddError);
    const done = await setQuickNoteCompleted(other.id, true, ownerId);
    expect(done.completedAt).not.toBeNull();
    const reopened = await setQuickNoteCompleted(other.id, false, ownerId);
    expect(reopened.completedAt).toBeNull();

    // A firm-wide note needs an explicit client for the follow-up task.
    await expect(createTaskFromNote(other.id, {}, ownerId, TEST_TODAY)).rejects.toThrow(
      "Pick a client",
    );
    const spun = await createTaskFromNote(other.id, { clientId: client.id }, ownerId, TEST_TODAY);
    expect(spun.task.clientId).toBe(client.id);
  });

  // Item 2 (C16): the billing timeline composes invoices + line items for the
  // client page; the read stays owner/admin-gated at getClientBilling. Here:
  // the data shape the timeline renders (statuses, dates, line items).
  it("billing_timeline_composes_full_history_with_line_items", async () => {
    const [client] = await db
      .insert(clients)
      .values({
        legalName: "Timeline Co",
        bookkeepingFrequency: "monthly",
        billingFrequency: "monthly",
        monthlyCloseTier: "15",
        bookkeepingStartDate: "2026-01-01",
        monthlyRecurringAmount: "100.00",
      })
      .returning();
    await generateMonthlyInvoices(2026, 7, TEST_TODAY);
    await generateMonthlyInvoices(2026, 8, TEST_TODAY);
    const rows = await db
      .select()
      .from(invoices)
      .where(eq(invoices.clientId, client.id))
      .orderBy(invoices.id);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const lines = await db
        .select()
        .from(invoiceLineItems)
        .where(eq(invoiceLineItems.invoiceId, row.id));
      expect(lines.length).toBeGreaterThan(0);
      expect(lines[0].description).toBe("Monthly Bookkeeping Services");
    }
    // Newest first by id is the timeline's default sort.
    expect(rows[1].id).toBeGreaterThan(rows[0].id);
    expect(rows.map((r) => r.status)).toEqual(["draft", "draft"]);
  });
});

// ── J2 (meeting #3) server-layer pins ──────────────────────────────────────

describe.skipIf(!reachable)("J2 interaction-fix wave (server layer)", () => {
  let ownerId: number;
  let bookkeeperId: number;

  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    ownerId = await userIdByEmail("mara@blueledgerbooks.com");
    bookkeeperId = await userIdByEmail("sofia@blueledgerbooks.com");
  });

  // Item 5: the estimated 1099 count prices count x the per-filing rate when
  // collection OR management is selected (never duplicated when the explicit
  // per-filing service is already on).
  it("ten99_estimate_prices_count_times_rate", async () => {
    const collection = await calculateIntakeQuoteWithConfig(
      {
        bookkeepingFrequency: "monthly",
        serviceKeys: ["bank_feed_management", "1099_collection"],
        estimated1099Count: 12,
      },
      TEST_TODAY,
    );
    const line = collection.lines.find((l) => l.service_key === "1099_per_filing")!;
    expect(line.unit_price).toBe(10);
    expect(line.quantity).toBe(12);
    expect(line.amount).toBe(120);
    // February-billed: the per-filing line lands in the annual bucket with
    // the collection service ($50/yr), off the monthly rate.
    expect(collection.totals.totalFebruaryBilledAnnual).toBe(170);

    const management = await calculateIntakeQuoteWithConfig(
      {
        bookkeepingFrequency: "monthly",
        serviceKeys: ["bank_feed_management", "1099_full_management"],
        estimated1099Count: 4,
      },
      TEST_TODAY,
    );
    expect(management.lines.find((l) => l.service_key === "1099_per_filing")?.amount).toBe(40);

    // An explicit per-filing pick already carries the count - one line only.
    const explicit = await calculateIntakeQuoteWithConfig(
      {
        bookkeepingFrequency: "monthly",
        serviceKeys: ["bank_feed_management", "1099_per_filing"],
        estimated1099Count: 7,
      },
      TEST_TODAY,
    );
    expect(explicit.lines.filter((l) => l.service_key === "1099_per_filing")).toHaveLength(1);
    expect(explicit.lines.find((l) => l.service_key === "1099_per_filing")?.amount).toBe(70);

    // No count -> no line (never a guessed filing count).
    const noCount = await calculateIntakeQuoteWithConfig(
      { bookkeepingFrequency: "monthly", serviceKeys: ["bank_feed_management", "1099_collection"] },
      TEST_TODAY,
    );
    expect(noCount.lines.some((l) => l.service_key === "1099_per_filing")).toBe(false);
  });

  // Item 6 (R6): the missed-filings count derives from the last-filed date x
  // cadence through today; the retro one-time pricing keeps working.
  it("missed_filings_derive_from_last_filed_date", async () => {
    // Monthly report last filed 2026-05-20, today 2026-08-15: June and July
    // periods are owed (the current August period is being worked live).
    const quote = await calculateIntakeQuoteWithConfig(
      {
        bookkeepingFrequency: "monthly",
        serviceKeys: ["bank_feed_management"],
        reportDefinitions: [
          { name: "City lodging tax", frequency: "monthly", flatPrice: 200, missedFilings: true, lastFiledDate: "2026-05-20" },
        ],
      },
      TEST_TODAY,
    );
    const retro = quote.lines.find((l) => l.service_key === "specialty_report_1_retro")!;
    expect(retro.quantity).toBe(2);
    expect(retro.amount).toBe(400);
    expect(retro.bucket).toBe("one_time");
    // The recurring line prices too (cadence-normalized).
    expect(quote.lines.some((l) => l.service_key === "specialty_report_1")).toBe(true);

    // Quarterly: last filed Q1 (2026-03-31) -> only the Q2 period is owed by 2026-08-15.
    const quarterly = await calculateIntakeQuoteWithConfig(
      {
        bookkeepingFrequency: "monthly",
        serviceKeys: ["bank_feed_management"],
        reportDefinitions: [
          { name: "OR quarterly", frequency: "quarterly", flatPrice: 100, missedFilings: true, lastFiledDate: "2026-03-31" },
        ],
      },
      TEST_TODAY,
    );
    expect(quarterly.lines.find((l) => l.service_key === "specialty_report_1_retro")?.quantity).toBe(1);

    // Legacy raw counts still price verbatim (pre-J2 intakes / extraction).
    const legacy = await calculateIntakeQuoteWithConfig(
      {
        bookkeepingFrequency: "monthly",
        serviceKeys: ["bank_feed_management"],
        reportDefinitions: [{ name: "Old report", frequency: "annual", flatPrice: 200, missedFilings: 3 }],
      },
      TEST_TODAY,
    );
    expect(legacy.lines.find((l) => l.service_key === "specialty_report_1_retro")?.quantity).toBe(3);

    // Yes without a date (defensive - the wizard blocks it) prices nothing.
    const noDate = await calculateIntakeQuoteWithConfig(
      {
        bookkeepingFrequency: "monthly",
        serviceKeys: ["bank_feed_management"],
        reportDefinitions: [{ name: "Mystery", frequency: "monthly", flatPrice: 200, missedFilings: true }],
      },
      TEST_TODAY,
    );
    expect(noDate.lines.some((l) => l.service_key.includes("_retro"))).toBe(false);
  });

  // Items E1-E3: the mandatory notes ride into the seeded tasks' descriptions.
  it("behavior_notes_ride_into_the_seeded_task_descriptions", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Behavior Notes Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "10",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        accounts: [{ name: "Operating", accountType: "checking", institution: "Chase", last4: "4411" }],
        depositsNonBusiness: true,
        personalOnBusiness: true,
        personalCardForBusiness: true,
        behaviorNotes: {
          "deposits-non-business": "Owner covers a bill from his personal account some months",
          "personal-on-business": "Groceries hit the business debit card",
          "personal-card": "The Amex picks up supplies",
        },
      },
    });
    const result = await convertIntakeToClient(intakeId, { bookkeeperId }, ownerId, TEST_TODAY);
    const rules = await db
      .select()
      .from(recurringTasks)
      .where(eq(recurringTasks.clientId, result.clientId));
    expect(rules.find((r) => r.title === NON_BUSINESS_DEPOSITS_REVIEW_TITLE)?.description).toBe(
      "Client context from intake: Owner covers a bill from his personal account some months",
    );
    expect(rules.find((r) => r.title === OWNER_DRAWS_CONFIRMATION_TITLE)?.description).toBe(
      "Client context from intake: Groceries hit the business debit card",
    );
    expect(rules.find((r) => r.title === PERSONAL_CARD_REMINDER_TITLE)?.description).toBe(
      "Client context from intake: The Amex picks up supplies",
    );

    // A yes with no stored note (legacy intakes) seeds the task with no description.
    const legacyId = await reviewableIntake({
      legalName: "Behavior Legacy Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "10",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        accounts: [{ name: "Operating", accountType: "checking", institution: "Chase", last4: "4411" }],
        personalCardForBusiness: true,
      },
    });
    const legacy = await convertIntakeToClient(legacyId, { bookkeeperId }, ownerId, TEST_TODAY);
    const legacyRules = await db
      .select()
      .from(recurringTasks)
      .where(eq(recurringTasks.clientId, legacy.clientId));
    const reminder = legacyRules.find((r) => r.title === PERSONAL_CARD_REMINDER_TITLE);
    expect(reminder).toBeDefined();
    expect(reminder!.description).toBeNull();
  });

  // Item E6: the bills split lands on the client record as a note; the record
  // side keeps pricing via record_bills (template check).
  it("bills_split_notes_land_on_the_client_record", async () => {
    const payId = await reviewableIntake({
      legalName: "Bill Pay Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "15",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management", "record_bills"],
        accounts: [{ name: "Operating", accountType: "checking", institution: "Chase", last4: "4411" }],
        recordBills: true,
        payBills: true,
        billPayLocations: ["Vendor websites", "Bank bill pay"],
      },
    });
    const payResult = await convertIntakeToClient(payId, {}, ownerId, TEST_TODAY);
    const payNotes = await db
      .select()
      .from(clientNotes)
      .where(eq(clientNotes.clientId, payResult.clientId));
    expect(payNotes.map((n) => n.body)).toContain(
      "Bills: we record and pay them. Bills get paid at: Vendor websites, Bank bill pay.",
    );

    const recordOnlyId = await reviewableIntake({
      legalName: "Record Only Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "15",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management", "record_bills"],
        accounts: [{ name: "Operating", accountType: "checking", institution: "Chase", last4: "4411" }],
        recordBills: true,
        payBills: false,
      },
    });
    const recordOnly = await convertIntakeToClient(recordOnlyId, {}, ownerId, TEST_TODAY);
    const recordNotes = await db
      .select()
      .from(clientNotes)
      .where(eq(clientNotes.clientId, recordOnly.clientId));
    expect(recordNotes.map((n) => n.body)).toContain("Bills: we record them; the client pays their own.");
  });

  // Item P1: self-processed payroll notes the client record; no
  // payroll-processing work or quote line seeds from it.
  it("self_processed_payroll_notes_the_client_and_seeds_no_processing_work", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Self Payroll Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "15",
      bookkeepingStartDate: "2026-01-01",
      payrollProvider: "Gusto",
      formData: {
        serviceKeys: ["bank_feed_management", "payroll_quarterly_filings"],
        accounts: [{ name: "Operating", accountType: "checking", institution: "Chase", last4: "4411" }],
        hasPayroll: true,
        payrollSelfProcessed: true,
      },
    });
    const result = await convertIntakeToClient(intakeId, {}, ownerId, TEST_TODAY);
    const notes = await db.select().from(clientNotes).where(eq(clientNotes.clientId, result.clientId));
    expect(notes.map((n) => n.body)).toContain(
      "Payroll: they process their own payroll (Gusto) - we download and enter the reports.",
    );
    // The billing template carries no payroll-processing line.
    const [client] = await db.select().from(clients).where(eq(clients.id, result.clientId));
    const template = client.recurringServicesTemplate as TemplateLineItem[];
    expect(template.some((l) => l.service_key === "process_payroll")).toBe(false);
    expect(template.some((l) => l.service_key === "payroll_quarterly_filings")).toBe(true);
    // And no payroll-processing recurring task exists for anyone.
    const rules = await db.select().from(recurringTasks).where(eq(recurringTasks.clientId, result.clientId));
    expect(rules.some((r) => /process payroll/i.test(r.title))).toBe(false);
  });

  // Item R6: the preliminary-reports choice notes the seeded Send Reports rule.
  it("preliminary_reports_note_rides_the_send_reports_rule", async () => {
    const yesId = await reviewableIntake({
      legalName: "Prelim Reports Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "10",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        accounts: [{ name: "Operating", accountType: "checking", institution: "Chase", last4: "4411" }],
        sendPreliminaryReports: true,
      },
    });
    const yesResult = await convertIntakeToClient(yesId, {}, ownerId, TEST_TODAY);
    const yesRules = await db
      .select()
      .from(recurringTasks)
      .where(eq(recurringTasks.clientId, yesResult.clientId));
    const sendReports = yesRules.find((r) => r.title === "Send Reports");
    expect(sendReports?.description).toBe(
      "Send the package even when client questions are still open, marked preliminary (intake choice).",
    );

    const noId = await reviewableIntake({
      legalName: "No Prelim Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "10",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        accounts: [{ name: "Operating", accountType: "checking", institution: "Chase", last4: "4411" }],
        sendPreliminaryReports: false,
      },
    });
    const noResult = await convertIntakeToClient(noId, {}, ownerId, TEST_TODAY);
    const noRules = await db
      .select()
      .from(recurringTasks)
      .where(eq(recurringTasks.clientId, noResult.clientId));
    expect(noRules.find((r) => r.title === "Send Reports")?.description ?? null).toBeNull();
  });
});

// ── J4 (meeting #3, V4) server-layer pins ────────────────────────────────────

describe.skipIf(!reachable)("J4 direct price editing (server layer)", () => {
  // V4 (01:01:22-01:02:14): servicePrices ride the quote-level map through
  // toQuoteInput; every line kind honors the override, and the billing
  // template carries it as the equivalent per-cycle discount (so invoices
  // bill the overridden price exactly) plus the raw price_override field.
  it("price_edit_replaces_discount_flow", () => {
    const quote = calculateIntakeQuote(
      {
        bookkeepingFrequency: "monthly",
        serviceKeys: ["bank_feed_management", "account_reconciliations", "process_payroll"],
        accounts: [
          { name: "Chase Checking · 4411", accountType: "checking", proofCategory: "statement" },
          { name: "Chase Savings · 1005", accountType: "savings", proofCategory: "statement" },
        ],
        serviceDiscounts: { account_reconciliations: 10 },
        servicePrices: { account_reconciliations: 40, process_payroll: 200 },
      },
      TEST_TODAY,
    );
    const recon = quote.lines.find((l) => l.service_key === "account_reconciliations")!;
    // 2 statement accounts x $25 = $50 standard; the $40 override wins over
    // the legacy $10 discount outright.
    expect(recon.amount).toBe(50);
    expect(recon.discount).toBe(10);
    expect(recon.price_override).toBe(40);
    // The unpriced payroll line prices at the override.
    const payroll = quote.lines.find((l) => l.service_key === "process_payroll")!;
    expect(payroll.unpriced).toBe(true);
    expect(payroll.price_override).toBe(200);
    // Totals: 100 + 40 + 200 effective.
    expect(quote.totals.effectiveMonthly).toBe(340);

    const template = buildRecurringServicesTemplate(quote);
    const reconTemplate = template.find((l) => l.service_key === "account_reconciliations")!;
    // The equivalent discount: 2 x $25 - $40 = $10 - invoices bill $40.
    expect(reconTemplate.discount).toBe(10);
    expect(reconTemplate.price_override).toBe(40);
    const payrollTemplate = template.find((l) => l.service_key === "process_payroll")!;
    // An override on an unpriced line cannot express as a discount; the raw
    // field carries and the priced-at-review note stays.
    expect(payrollTemplate.unit_price).toBeNull();
    expect(payrollTemplate.price_override).toBe(200);
    expect(payrollTemplate.notes).toContain("no amount stated");
  });

  // Legacy intakes carrying only serviceDiscounts price byte-identically to
  // the pre-J4 engine: the discount nets, no override is stamped, and the
  // template carries the discount verbatim.
  it("legacy discount data still prices identically", () => {
    const quote = calculateIntakeQuote(
      {
        bookkeepingFrequency: "monthly",
        serviceKeys: ["bank_feed_management"],
        serviceDiscounts: { bank_feed_management: 25 },
      },
      TEST_TODAY,
    );
    const line = quote.lines.find((l) => l.service_key === "bank_feed_management")!;
    expect(line.discount).toBe(25);
    expect(line.price_override).toBeUndefined();
    expect(quote.totals.effectiveMonthly).toBe(75);
    const template = buildRecurringServicesTemplate(quote);
    const row = template.find((l) => l.service_key === "bank_feed_management")!;
    expect(row.discount).toBe(25);
    expect(row.price_override).toBeUndefined();
  });

  // A retro-line override prices the whole cleanup flat; the template line
  // derives its discount from the gross (months x rate), not the overridden
  // amount, so billing still lands on the override.
  it("retro_override_prices_flat_and_carries_to_the_template", () => {
    const quote = calculateIntakeQuote(
      {
        bookkeepingFrequency: "monthly",
        serviceKeys: ["bank_feed_management", "retroactive_bookkeeping"],
        bookkeepingStartDate: "2026-01-01",
        servicePrices: { retroactive_bookkeeping: 500 },
      },
      TEST_TODAY, // 2026-08-15 -> 7 retro months x $100/mo = $700 standard
    );
    expect(quote.retroactive?.months).toBe(7);
    expect(quote.retroactive?.total).toBe(500);
    expect(quote.totals.totalOneTime).toBe(500); // once, never twice
    const template = buildRecurringServicesTemplate(quote);
    const retroTemplate = template.find((l) => l.service_key === "retroactive_bookkeeping")!;
    expect(retroTemplate.discount).toBe(200); // 7 x $100 gross - $500 override
    expect(retroTemplate.price_override).toBe(500);
  });
});
