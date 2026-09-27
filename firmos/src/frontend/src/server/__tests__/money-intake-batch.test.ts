import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import {
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
import { calculateIntakeQuoteWithConfig, type TemplateLineItem } from "@/server/quote";
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
        accounts: [{ name: "Operating", accountType: "checking" }],
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
        accounts: [{ name: "Operating", accountType: "checking" }],
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
        accounts: [{ name: "Operating", accountType: "checking" }],
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
        accounts: [{ name: "Operating", accountType: "checking" }],
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
        accounts: [{ name: "Operating", accountType: "checking" }],
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
        accounts: [{ name: "Operating", accountType: "checking" }],
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
        accounts: [{ name: "Operating", accountType: "checking" }],
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
        accounts: [{ name: "Operating", accountType: "checking" }],
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
    expect(result.recurringRulesCreated).toBe(2);
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
        accounts: [{ name: "Operating", accountType: "checking" }],
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
