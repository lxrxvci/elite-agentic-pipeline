import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, eq, lte } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { categoryCompletion, parseLocalDate } from "@firmos/domain";

import { db } from "@/db";
import {
  accountReconciliations,
  accounts,
  clientReports,
  clients,
  contactClientLinks,
  contacts,
  invoiceLineItems,
  invoices,
  projects,
  projectTasks,
  recurringTasks,
  tasks,
  users,
  weeklyBankFeeds,
} from "@/db/schema";
import { getClientBilling, getClientDetail, healthSummaryFromRows, listContacts } from "@/server/clients";
import { convertIntakeToClient } from "@/server/convert";
import { uploadStatement } from "@/server/documents";
import {
  createIntake,
  getIntake,
  submitIntakeForReview,
  updateIntake,
  type IntakePatch,
} from "@/server/intake";
import { generateMonthlyInvoices } from "@/server/invoices";
import { materializeOperationalRows } from "@/server/materialize";
import { getFirmProgressionBoard } from "@/server/progression";
import { catchUpRangesFor } from "@/server/projects";
import { createProperty } from "@/server/properties";
import { quickAddTask } from "@/server/quick-add";
import { getUnifiedQueue } from "@/server/queue";
import type { TemplateLineItem } from "@/server/quote";
import { seedDatabase } from "@/server/seed";
import {
  getStatementQueue,
  getStatementsGrid,
  statementStatusForAccount,
} from "@/server/statements";
import { __resetStorageForTests } from "@/server/storage";
import { getClientYearGrid } from "@/server/year-grid";
import { PROFORMA_FIGURE_FIELDS } from "@/shared/lib/proforma";

import { dbReachable, TEST_TODAY } from "./helpers";

/**
 * Jason regression suite (server layer) - one test per bug Jason hit live in
 * the old system during the recorded walkthrough (2026-09-22). Each test is
 * named after his exact scenario so the mapping to his complaints is direct.
 * Scenario 1's pricing math itself lives in the domain suite
 * (packages/domain/test/jason-regression.test.ts); here its billing path.
 */

// requireStaff/requireRole read the HTTP session, which does not exist under
// vitest; stub them like progression.test.ts does.
vi.mock("@/server/auth/guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/guards")>();
  return {
    ...actual,
    requireStaff: vi.fn(async () => undefined),
    requireRole: vi.fn(async () => undefined),
  };
});

const reachable = await dbReachable();

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

/** The walkthrough "today": the Agentic PNW test client converts in 2026 with books starting March 2025. */
const CONVERSION_TODAY = TEST_TODAY; // 2026-08-15
const CATCHUP_ANCHOR = "2026-08-01";

function tline(
  service_key: string,
  product_name: string,
  unit_price: number | null,
  quantity: number,
  extra: Record<string, unknown> = {},
): TemplateLineItem {
  return {
    service_key,
    product_name,
    unit_price,
    quantity,
    discount: 0,
    frequency: "monthly",
    notes: null,
    ...extra,
  };
}

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

async function invoiceFor(clientId: number, year: number, month: number) {
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.clientId, clientId), eq(invoices.year, year), eq(invoices.month, month)))
    .limit(1);
  return invoice ?? null;
}

async function linesFor(invoiceId: number) {
  return db
    .select()
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, invoiceId))
    .orderBy(invoiceLineItems.position);
}

describe.skipIf(!reachable)("jason regression suite (server layer)", () => {
  let docsRootTmp = "";
  let ownerId: number;
  let managerId: number;
  let bookkeeperId: number;

  beforeAll(async () => {
    docsRootTmp = mkdtempSync(path.join(tmpdir(), "firmos-docs-jason-"));
    process.env.FIRMOS_DOCS_ROOT = docsRootTmp;
    __resetStorageForTests();
    await seedDatabase(TEST_TODAY);
    ownerId = await userIdByEmail("mara@blueledgerbooks.com");
    managerId = await userIdByEmail("dana@blueledgerbooks.com");
    bookkeeperId = await userIdByEmail("sofia@blueledgerbooks.com");
  });

  afterAll(() => {
    if (docsRootTmp) rmSync(docsRootTmp, { recursive: true, force: true });
    delete process.env.FIRMOS_DOCS_ROOT;
    __resetStorageForTests();
  });

  // Scenario 1 (01:25:31) - the invoice half: a discounted template line bills
  // net per month, and a discount can never make a line or an invoice negative
  // (the old system's negative-client-balance production bug).
  it("quote_discount_25_off_100_times_18_months_equals_1350", async () => {
    const [client] = await db
      .insert(clients)
      .values({
        legalName: "Jason Discount Fixture",
        bookkeepingFrequency: "monthly",
        billingFrequency: "monthly",
        monthlyCloseTier: "15",
        bookkeepingStartDate: "2026-01-01",
        recurringServicesTemplate: [
          tline("bank_feed_management", "Bank Feed Management", 100, 1, { discount: 25 }),
        ],
      })
      .returning();

    await generateMonthlyInvoices(2026, 8, TEST_TODAY);
    const invoice = await invoiceFor(client.id, 2026, 8);
    expect(invoice).not.toBeNull();
    const lines = new Map((await linesFor(invoice!.id)).map((l) => [l.serviceKey, l]));
    // $100/mo service with a $25 discount bills $75/mo effective.
    expect(lines.get("bank_feed_management")).toMatchObject({ amount: "100.00", discount: "25.00" });
    expect(lines.get("__section_discount__")).toMatchObject({
      description: "Preferred Customer Discount",
      amount: "-25.00",
    });
    expect(invoice!.total).toBe("75.00");

    // The billing tab's per-month read agrees: (100 x 1 - 25) / 1 = 75.
    const billing = await getClientBilling(client.id);
    expect(billing!.lines.find((l) => l.serviceKey === "bank_feed_management")?.monthlyAmount).toBe(75);
    expect(billing!.monthlyTotal).toBe(75);

    // The 18-month retroactive stretch at that discounted $75/mo rate is the
    // domain quote engine's job; packages/domain/test/jason-regression.test.ts
    // pins 75 x 18 = 1350 there.

    // The clamp: a discount larger than the line zeroes the invoice out -
    // never a negative line net, never a negative invoice total.
    const [clampedClient] = await db
      .insert(clients)
      .values({
        legalName: "Jason Overdiscount Fixture",
        bookkeepingFrequency: "monthly",
        billingFrequency: "monthly",
        monthlyCloseTier: "15",
        bookkeepingStartDate: "2026-01-01",
        recurringServicesTemplate: [
          tline("bank_feed_management", "Bank Feed Management", 100, 1, { discount: 150 }),
        ],
      })
      .returning();
    await generateMonthlyInvoices(2026, 8, TEST_TODAY);
    const clampedInvoice = await invoiceFor(clampedClient.id, 2026, 8);
    expect(clampedInvoice).not.toBeNull();
    const clampedLines = new Map((await linesFor(clampedInvoice!.id)).map((l) => [l.serviceKey, l]));
    // The discount line is capped at the discounted line's billed amount.
    expect(Number(clampedLines.get("__section_discount__")!.amount)).toBe(-100);
    expect(Number(clampedInvoice!.total)).toBe(0);
    expect(Number(clampedInvoice!.total)).toBeGreaterThanOrEqual(0);
  });

  // Scenario 2 (01:24:43): retroactive work spanning calendar years generates
  // ONE catch-up project per year at conversion, never a single merged blob.
  it("catchup_projects_split_by_year", async () => {
    // The suggestion engine splits Mar-2025-start -> two yearly ranges.
    expect(catchUpRangesFor({ year: 2025, month: 3, day: 1 }, CONVERSION_TODAY)).toEqual([
      { year: 2025, fromMonth: 3, toMonth: 12 },
      { year: 2026, fromMonth: 1, toMonth: 7 },
    ]);

    const intakeId = await reviewableIntake({
      legalName: "Split Year Retro Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "15",
      bookkeepingStartDate: "2025-03-01",
      formData: {
        serviceKeys: ["bank_feed_management", "retroactive_bookkeeping"],
        accounts: [{ name: "Operating Checking", accountType: "checking", institution: "Chase" }],
      },
    });
    const result = await convertIntakeToClient(intakeId, { managerId }, ownerId, CONVERSION_TODAY);
    expect(result.catchUpProjectsCreated).toBe(2);

    const projectRows = await db.select().from(projects).where(eq(projects.clientId, result.clientId));
    // One project per calendar year - never a merged "Catch-up Bookkeeping" blob.
    expect(projectRows.map((p) => p.name).sort()).toEqual([
      "Catch-up Bookkeeping 2025",
      "Catch-up Bookkeeping 2026",
    ]);
    expect(projectRows.every((p) => p.autoGenerateTasks)).toBe(true);

    // Each year's project carries that year's per-account monthly-grid tasks.
    for (const project of projectRows) {
      const year = project.name.match(/(\d{4})$/)![1];
      const rows = await db
        .select()
        .from(projectTasks)
        .where(eq(projectTasks.projectId, project.id));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((t) => t.taskKind === "time_period")).toBe(true);
      expect(rows.every((t) => t.title.endsWith(`- ${year} catch-up`))).toBe(true);
    }
    const p2025 = projectRows.find((p) => p.name === "Catch-up Bookkeeping 2025")!;
    const tasks2025 = await db.select().from(projectTasks).where(eq(projectTasks.projectId, p2025.id));
    expect(tasks2025.map((t) => t.title)).toContain("Operating Checking - 2025 catch-up");

    // No retroactive scope -> no catch-up projects (control).
    const cleanIntake = await reviewableIntake({
      legalName: "No Retro Co",
      bookkeepingFrequency: "monthly",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        accounts: [{ name: "Checking", accountType: "checking" }],
      },
    });
    const clean = await convertIntakeToClient(cleanIntake, {}, ownerId, CONVERSION_TODAY);
    expect(clean.catchUpProjectsCreated).toBe(0);
    const cleanProjects = await db.select().from(projects).where(eq(projects.clientId, clean.clientId));
    expect(cleanProjects).toHaveLength(0);
  });

  // Scenario 3 (01:36:40, 01:51:03): a client whose books start March 1 2025
  // never shows statement/bank-feed/reconciliation periods before March 2025.
  it("statements_never_before_start_date", async () => {
    const midYearToday = { year: 2025, month: 8, day: 15 };

    // The derived queue's pure math: missing months start at March, not January.
    const status = statementStatusForAccount(
      { statementDay: 31, openDate: "2025-03-01" },
      { bookkeepingFrequency: "monthly", monthlyCloseTier: "15", bookkeepingStartDate: "2025-03-01" },
      [],
      midYearToday,
    );
    expect(status.earliestMissingPeriod).toEqual({ year: 2025, month: 3 });
    expect(status.missingCount).toBe(5); // Mar..Jul 2025 - never Jan/Feb

    const [client] = await db
      .insert(clients)
      .values({
        legalName: "March Start Co",
        bookkeepingFrequency: "monthly",
        monthlyCloseTier: "15",
        bookkeepingStartDate: "2025-03-01",
        requiresWeeklyBankFeeds: true,
      })
      .returning();
    const [account] = await db
      .insert(accounts)
      .values({
        clientId: client.id,
        name: "Operating",
        accountType: "checking",
        statementDay: 31,
        openDate: "2025-03-01",
      })
      .returning();

    await materializeOperationalRows(midYearToday);

    // Materialized reconciliation rows: nothing attributed before March 2025.
    const recons = await db
      .select()
      .from(accountReconciliations)
      .where(eq(accountReconciliations.clientId, client.id));
    expect(recons.length).toBeGreaterThan(0);
    expect(
      recons.every(
        (r) => r.attributedYear > 2025 || (r.attributedYear === 2025 && r.attributedMonth >= 3),
      ),
    ).toBe(true);

    // Materialized bank-feed rows: no week ending before the start date.
    const feeds = await db
      .select()
      .from(weeklyBankFeeds)
      .where(eq(weeklyBankFeeds.clientId, client.id));
    expect(feeds.length).toBeGreaterThan(0);
    expect(feeds.every((f) => f.weekEndDate >= "2025-03-01")).toBe(true);

    // The derived statement queue + grid: no pre-March periods either.
    const queue = await getStatementQueue(midYearToday);
    const row = queue.find((r) => r.accountId === account.id)!;
    expect(row.status.earliestMissingPeriod).toEqual({ year: 2025, month: 3 });
    const grid = await getStatementsGrid(client.id, midYearToday);
    const accountGrid = grid.accounts.find((a) => a.accountId === account.id)!;
    expect(accountGrid.cells.length).toBeGreaterThan(0);
    expect(accountGrid.cells[0]).toMatchObject({ year: 2025, month: 3 });
    expect(
      accountGrid.cells.every((c) => c.year > 2025 || (c.year === 2025 && c.month >= 3)),
    ).toBe(true);
  });

  // Scenario 4 (01:36:40): uploading a statement satisfies the queue item by
  // derivation (no manual checkbox), and the reconciliation checklist card
  // reads the same derivation.
  it("statement_upload_auto_completes_checklist", async () => {
    const [client] = await db
      .insert(clients)
      .values({
        legalName: "Auto Check Co",
        bookkeepingFrequency: "monthly",
        monthlyCloseTier: "15",
        bookkeepingStartDate: "2026-01-01",
      })
      .returning();
    const [account] = await db
      .insert(accounts)
      .values({ clientId: client.id, name: "Operating", accountType: "checking", statementDay: 31 })
      .returning();
    await materializeOperationalRows(TEST_TODAY); // recon rows exist to check off

    const missingBefore = (await getStatementQueue(TEST_TODAY)).find(
      (r) => r.accountId === account.id,
    )!.status.missingCount;
    expect(missingBefore).toBeGreaterThan(0);
    const cardBefore = Object.values((await getUnifiedQueue(ownerId, TEST_TODAY)).buckets)
      .flat()
      .find((c) => c.kind === "reconciliation" && c.clientId === client.id && c.attributedMonth === 6);
    expect(cardBefore?.statementAvailable).toBe(false);

    // The only write: the statement document. No status column, no checkbox.
    const uploaded = await uploadStatement({
      accountId: account.id,
      uploadedById: ownerId,
      fileName: "june.pdf",
      mimeType: "application/pdf",
      bytes: PDF_BYTES,
      statementDate: "2026-06-30",
      today: TEST_TODAY,
    });
    expect(uploaded.period).toEqual({ year: 2026, month: 6 });

    // Queue item satisfied by derivation.
    const missingAfter = (await getStatementQueue(TEST_TODAY)).find(
      (r) => r.accountId === account.id,
    )!.status.missingCount;
    expect(missingAfter).toBe(missingBefore - 1);

    // The grid cell flips to uploaded.
    const grid = await getStatementsGrid(client.id, TEST_TODAY);
    const june = grid.accounts
      .find((a) => a.accountId === account.id)!
      .cells.find((c) => c.year === 2026 && c.month === 6)!;
    expect(june.state).toBe("uploaded");
    expect(june.documentId).toBe(uploaded.document.id);

    // The reconciliation card (the checklist surface) reads the same
    // derivation: the statement shows available with no separate sync.
    const cardAfter = Object.values((await getUnifiedQueue(ownerId, TEST_TODAY)).buckets)
      .flat()
      .find((c) => c.kind === "reconciliation" && c.clientId === client.id && c.attributedMonth === 6);
    expect(cardAfter?.statementAvailable).toBe(true);
    expect(cardAfter?.statementBalance).toBeNull();
  });

  // Scenario 5 (01:43:06): conversion must not create bank-sync/feed tasks
  // when no account has online access.
  it("no_sync_tasks_without_online_access", async () => {
    const offlineIntake = await reviewableIntake({
      legalName: "Offline Bank Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "15",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        accounts: [
          { name: "Manual Checking", accountType: "checking", requiresManualTransactions: true },
          { name: "Manual Credit Card", accountType: "credit_card", requiresManualTransactions: true },
        ],
      },
    });
    const offline = await convertIntakeToClient(offlineIntake, {}, ownerId, CONVERSION_TODAY);
    const offlineTasks = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.clientId, offline.clientId), eq(tasks.taskType, "onboarding")));
    expect(offlineTasks.some((t) => /bank feed|bank sync|sync status/i.test(t.title))).toBe(false);
    // The rest of the checklist is untouched (only the feed task is gated).
    // A46: 9 seeded rows - the one online-access-gated row = 8 materialized.
    expect(offlineTasks.length).toBe(8);
    // A46: the vault-fill admin-phase row is not feed-gated - it materializes.
    expect(offlineTasks.some((t) => t.title === "Fill in login credentials in the secure vault")).toBe(true);
    // The accounts themselves keep their manual-download flag.
    const offlineAccounts = await db
      .select()
      .from(accounts)
      .where(eq(accounts.clientId, offline.clientId));
    expect(
      offlineAccounts.filter((a) => a.statementDay != null).every((a) => a.requiresManualTransactions),
    ).toBe(true);

    // Control: with at least one online-capable account the task is created.
    const onlineIntake = await reviewableIntake({
      legalName: "Online Bank Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "15",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        accounts: [
          { name: "Online Checking", accountType: "checking" },
          { name: "Manual Savings", accountType: "savings", requiresManualTransactions: true },
        ],
      },
    });
    const online = await convertIntakeToClient(onlineIntake, {}, ownerId, CONVERSION_TODAY);
    const onlineTasks = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.clientId, online.clientId), eq(tasks.taskType, "onboarding")));
    expect(onlineTasks.some((t) => t.title === "Connect bank feeds for all accounts")).toBe(true);
  });

  // Scenario 6 (01:22:51): a property financed via "Mr. Cooper" bills under the
  // deterministic PRICING-table line - never a mangled "custom ..." label - and
  // there is no pro-forma-only mortgage channel that could bypass billing.
  it("property_loan_naming", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Cooper Mortgage Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "15",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management", "loans_and_liabilities"],
        accounts: [{ name: "Property A Mortgage", accountType: "mortgage", institution: "Mr. Cooper" }],
      },
    });
    const result = await convertIntakeToClient(intakeId, {}, ownerId, CONVERSION_TODAY);
    const [client] = await db.select().from(clients).where(eq(clients.id, result.clientId));
    const template = client.recurringServicesTemplate as TemplateLineItem[];

    const loanLine = template.find((l) => l.service_key === "loans_and_liabilities");
    expect(loanLine).toBeDefined();
    // The deterministic convention: the PRICING-table product name. Lender
    // names are data on the account/property, never mangled into a label.
    expect(loanLine!.product_name).toBe("Loans and Liabilities");
    expect(template.some((l) => /custom/i.test(l.product_name))).toBe(false);
    expect(template.some((l) => /cooper/i.test(l.product_name))).toBe(false);
    // The lender rides the account record as data.
    const mortgageAccount = (await db.select().from(accounts).where(eq(accounts.clientId, client.id))).find(
      (a) => a.accountType === "mortgage",
    );
    expect(mortgageAccount?.institution).toBe("Mr. Cooper");

    // The old system's open bug was pro-forma-only mortgages never billing.
    // Structurally dead here: pro-forma figures carry no mortgage/loan/lender
    // keys, so a mortgage has exactly one home (the property record) - and
    // that home triggers the billing resync.
    expect(PROFORMA_FIGURE_FIELDS.some((f) => /mortgage|loan|lender/i.test(f))).toBe(false);

    const [reClient] = await db
      .insert(clients)
      .values({
        legalName: "Proforma Path Co",
        bookkeepingFrequency: "monthly",
        monthlyCloseTier: "15",
        bookkeepingStartDate: "2026-01-01",
        isRealEstateClient: true,
      })
      .returning();
    const property = await createProperty(ownerId, {
      clientId: reClient.id,
      name: "Property A",
      propertyType: "commercial",
    });
    expect(property.mortgageLender).toBeNull();
    let [row] = await db.select().from(clients).where(eq(clients.id, reClient.id));
    expect(
      (row.recurringServicesTemplate as TemplateLineItem[]).some(
        (l) => l.service_key === "loans_and_liabilities",
      ),
    ).toBe(false);

    // Entering the mortgage reaches billing through the resync trigger.
    const { updateProperty } = await import("@/server/properties");
    await updateProperty(ownerId, property.id, {
      mortgageLender: "Mr. Cooper",
      mortgageBalance: "250000",
    });
    [row] = await db.select().from(clients).where(eq(clients.id, reClient.id));
    const resynced = row.recurringServicesTemplate as TemplateLineItem[];
    const resyncedLoan = resynced.find((l) => l.service_key === "loans_and_liabilities");
    expect(resyncedLoan).toBeDefined();
    expect(resyncedLoan!.product_name).toBe("Loans and Liabilities");
  });

  // Scenario 7 (02:18:07): the health view and the bank-feed grid read the
  // same rows - feeds complete through July can never show 0/6 on health.
  it("client_health_matches_bank_feeds", async () => {
    const [client] = await db
      .insert(clients)
      .values({
        legalName: "Health Mirrors Feeds Co",
        bookkeepingFrequency: "monthly",
        monthlyCloseTier: "15",
        bookkeepingStartDate: "2026-01-01",
        requiresWeeklyBankFeeds: true,
      })
      .returning();
    await db
      .insert(accounts)
      .values({ clientId: client.id, name: "Operating", accountType: "checking", statementDay: 31 });
    await materializeOperationalRows(TEST_TODAY);

    // Feeds complete through July (the Dental Plus USA scenario).
    await db
      .update(weeklyBankFeeds)
      .set({ completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(weeklyBankFeeds.clientId, client.id), lte(weeklyBankFeeds.attributedMonth, 7)));

    const feedRows = await db.select().from(weeklyBankFeeds).where(eq(weeklyBankFeeds.clientId, client.id));
    const reconRows = await db
      .select()
      .from(accountReconciliations)
      .where(eq(accountReconciliations.clientId, client.id));
    expect(feedRows.length).toBeGreaterThan(0);
    expect(reconRows.length).toBeGreaterThan(0);

    // The grid surface: every month through July reads complete.
    const grid = await getClientYearGrid(client.id, 2026, TEST_TODAY);
    const feedCells = grid!.rows.find((r) => r.stream === "bank_feeds")!.cells;
    expect(feedCells.filter((c) => c.month <= 7).every((c) => c.state === "complete")).toBe(true);

    // Same rows, same truth: the domain's category completion over the rows
    // the 2026 grid scores equals the grid's own completed/total ratio.
    const toHealthRow = (r: (typeof feedRows)[number]) => ({
      completed: r.completedAt != null,
      due_date: r.dueDate ? parseLocalDate(r.dueDate) : null,
      waiting_on_client: r.waitingOnClient,
      deferred_until: r.deferredUntil ? parseLocalDate(r.deferredUntil) : null,
    });
    const feeds2026 = feedRows.filter((r) => r.attributedYear === 2026);
    const feedCompletion2026 = categoryCompletion(feeds2026.map(toHealthRow), {});
    const gridTotal = feedCells.reduce((sum, c) => sum + c.total, 0);
    const gridDone = feedCells.reduce((sum, c) => sum + c.completed, 0);
    expect(feedCompletion2026).not.toBeNull();
    expect(feedCompletion2026!).toBeGreaterThan(0);
    expect(feedCompletion2026!).toBeCloseTo((gridDone / gridTotal) * 100, 6);

    // The health score both surfaces print is the SAME function's output over
    // the SAME rows: feeds done through July can never read as 0/6.
    const health = healthSummaryFromRows(
      client,
      { feeds: feedRows, recons: reconRows, reports: [], openTasks: [] },
      TEST_TODAY,
    );
    const feedCompletionAll = categoryCompletion(feedRows.map(toHealthRow), {});
    expect(health).not.toBeNull();
    // feeds at feedCompletionAll%, recons at 0%, reports inapplicable, no penalty.
    expect(health!.score).toBe(Math.round((feedCompletionAll! + 0) / 2));
    expect(health!.score).toBeGreaterThan(0); // the old 0/6 report is dead

    const board = await getFirmProgressionBoard(2026, TEST_TODAY);
    const boardRow = board.rows.find((r) => r.clientId === client.id)!;
    expect(boardRow.health).toEqual(health);
  });

  // Scenario 8 (01:30:43): tasks carry individual due dates, and catch-up
  // periods created at conversion never produce rows dated before the anchor.
  it("per_task_due_dates", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Catchup Anchor Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "15",
      bookkeepingStartDate: "2025-03-01",
      bankFeedCatchupDate: CATCHUP_ANCHOR,
      reportDefinitions: [{ name: "Monthly Financial Package", frequency: "monthly" }],
      formData: {
        serviceKeys: ["bank_feed_management", "account_reconciliations", "monthly_reporting_15"],
        accounts: [{ name: "Operating", accountType: "checking", statementDay: 31 }],
      },
    });
    const result = await convertIntakeToClient(intakeId, { managerId, bookkeeperId }, ownerId, CONVERSION_TODAY);

    // Nothing may be due before the catch-up anchor - the old system's wall of
    // instantly-overdue rows (dated months in the past on day one) is dead.
    const dueRows: Record<string, (string | null)[]> = {
      tasks: (await db.select().from(tasks).where(eq(tasks.clientId, result.clientId))).map((t) => t.dueDate),
      feeds: (await db.select().from(weeklyBankFeeds).where(eq(weeklyBankFeeds.clientId, result.clientId))).map((r) => r.dueDate),
      recons: (await db.select().from(accountReconciliations).where(eq(accountReconciliations.clientId, result.clientId))).map((r) => r.dueDate),
      reports: (await db.select().from(clientReports).where(eq(clientReports.clientId, result.clientId))).map((r) => r.dueDate),
    };
    expect(dueRows.feeds.length).toBeGreaterThan(0);
    expect(dueRows.recons.length).toBeGreaterThan(0);
    expect(dueRows.reports.length).toBeGreaterThan(0);
    for (const [kind, dues] of Object.entries(dueRows)) {
      for (const due of dues) {
        expect(due, `${kind} row has no due date`).not.toBeNull();
        expect(due! >= CATCHUP_ANCHOR, `${kind} row due ${due} predates the catch-up anchor`).toBe(true);
      }
    }

    // Catch-up periods share the floored anchor date; the current period keeps
    // its own natural due date. Per-period dates, not one bulk default.
    const recurringInstances = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.clientId, result.clientId), eq(tasks.taskType, "recurring")));
    const distinctDues = new Set(recurringInstances.map((t) => t.dueDate));
    expect(distinctDues.size).toBeGreaterThan(1);
    expect(distinctDues.has(CATCHUP_ANCHOR)).toBe(true); // the floored catch-up batch
    expect([...distinctDues].some((d) => d! > CATCHUP_ANCHOR)).toBe(true);

    // An ad-hoc task carries its own due date ("QBO setup by next week").
    const adhoc = await quickAddTask(
      { clientId: result.clientId, title: "Set up QuickBooks for invoicing", dueDate: "2026-08-21" },
      ownerId,
      CONVERSION_TODAY,
    );
    expect(adhoc.dueDate).toBe("2026-08-21");

    // Onboarding tasks default to the conversion day, and one can be moved
    // individually - the checklist surface reports each task's own date.
    const detailBefore = await getClientDetail(result.clientId);
    expect(detailBefore!.onboarding.length).toBeGreaterThan(0);
    expect(detailBefore!.onboarding.every((t) => t.dueDate === "2026-08-15")).toBe(true);
    const firstOnboarding = detailBefore!.onboarding[0];
    await db.update(tasks).set({ dueDate: "2026-08-22" }).where(eq(tasks.id, firstOnboarding.id));
    const detailAfter = await getClientDetail(result.clientId);
    const moved = detailAfter!.onboarding.find((t) => t.id === firstOnboarding.id)!;
    const rest = detailAfter!.onboarding.filter((t) => t.id !== firstOnboarding.id);
    expect(moved.dueDate).toBe("2026-08-22");
    expect(rest.every((t) => t.dueDate === "2026-08-15")).toBe(true);
  });

  // Scenario 9 (02:28:57): contacts linked to more than two clients (and
  // clients with more than two contacts) return the FULL set - no "+2 more" cap.
  it("contacts_expand_beyond_two", async () => {
    const linkClients = await db
      .insert(clients)
      .values([{ legalName: "Linked Co A" }, { legalName: "Linked Co B" }, { legalName: "Linked Co C" }])
      .returning();
    const [shared] = await db
      .insert(contacts)
      .values({ type: "individual", firstName: "Multi", lastName: "Link" })
      .returning();
    await db.insert(contactClientLinks).values(
      linkClients.map((c) => ({
        contactId: shared.id,
        clientId: c.id,
        relationshipType: "related" as const,
      })),
    );

    // The directory returns all three links for the shared contact.
    const directory = await listContacts();
    const row = directory.rows.find((r) => r.id === shared.id)!;
    expect(row.clients).toHaveLength(3);
    expect(row.clients.map((c) => c.clientId).sort((a, b) => a - b)).toEqual(
      linkClients.map((c) => c.id).sort((a, b) => a - b),
    );

    // A client with more than two contacts: the detail read returns them all.
    const extraContacts = await db
      .insert(contacts)
      .values([
        { type: "individual", firstName: "Second", lastName: "Contact" },
        { type: "individual", firstName: "Third", lastName: "Contact" },
        { type: "entity", entityName: "Fourth Contact LLC" },
      ])
      .returning();
    await db.insert(contactClientLinks).values(
      extraContacts.map((c) => ({
        contactId: c.id,
        clientId: linkClients[0].id,
        relationshipType: "related" as const,
      })),
    );
    const detail = await getClientDetail(linkClients[0].id);
    const contactIds = detail!.contacts.map((c) => c.contactId);
    expect(detail!.contacts).toHaveLength(4); // shared + three more
    for (const c of [shared, ...extraContacts]) expect(contactIds).toContain(c.id);
  });

  // Scenario 10 (G3, 02:17:18) - Taiwan Restoration: a MONTHLY client with an
  // ANNUAL task must render both the monthly blocks and the annual block, each
  // in the right column. The annual rule's instance attributes backwards
  // (domain RULE 2: quarterly/semi-annual/annual always attribute to the
  // prior month), so the annual block belongs to the prior December column -
  // never smeared into January or dropped from the board.
  it("recurring_rollup_monthly_client_with_annual_task_shows_both", async () => {
    const [client] = await db
      .insert(clients)
      .values({
        legalName: "Taiwan Restoration Fixture",
        bookkeepingFrequency: "monthly",
        monthlyCloseTier: "15",
        bookkeepingStartDate: "2026-01-01",
      })
      .returning();

    const [monthlyRule] = await db
      .insert(recurringTasks)
      .values({
        clientId: client.id,
        title: "Monthly close work",
        scheduleType: "monthly",
        dayOfMonth: 15,
        nextRun: "2026-01-15",
      })
      .returning();
    const [annualRule] = await db
      .insert(recurringTasks)
      .values({
        clientId: client.id,
        title: "Annual tax filing",
        scheduleType: "annual",
        dayOfMonth: 15,
        anchorMonth: 1,
        nextRun: "2026-01-15",
      })
      .returning();

    const { runRecurringOnce } = await import("@/server/recurring");
    const summary = await runRecurringOnce(TEST_TODAY);
    expect(summary.tasksCreated).toBeGreaterThan(0);

    // Generation: the monthly rule made one instance per due month through
    // today (Jan 15 - Aug 15); the annual rule made exactly one.
    const monthlyInstances = await db
      .select()
      .from(tasks)
      .where(eq(tasks.recurringTaskId, monthlyRule.id));
    const annualInstances = await db
      .select()
      .from(tasks)
      .where(eq(tasks.recurringTaskId, annualRule.id));
    expect(monthlyInstances).toHaveLength(8);
    expect(annualInstances).toHaveLength(1);
    // The annual task attributes BACKWARDS: due Jan 15 2026 -> the December
    // 2025 column (the 2025 annual block), per RULE 2.
    expect(annualInstances[0]).toMatchObject({ attributedYear: 2025, attributedMonth: 12 });

    // The queue shows both blocks for the client: the current monthly close
    // AND the annual filing (overdue since January).
    const queue = await getUnifiedQueue(ownerId, TEST_TODAY);
    const cards = Object.values(queue.buckets)
      .flat()
      .filter((c) => c.clientId === client.id);
    const monthlyCard = cards.find((c) => c.title === "Monthly close work");
    const annualCard = cards.find((c) => c.title === "Annual tax filing");
    expect(monthlyCard).toBeDefined();
    expect(annualCard).toBeDefined();
    expect(annualCard).toMatchObject({ attributedYear: 2025, attributedMonth: 12 });

    // The 2025 board column: December carries BOTH blocks (the Dec monthly
    // close + the annual filing); January carries neither - the annual block
    // is not smeared across the year.
    const grid2025 = await getClientYearGrid(client.id, 2025, TEST_TODAY);
    const tasksRow2025 = grid2025!.rows.find((r) => r.stream === "tasks")!;
    const dec2025 = tasksRow2025.cells.find((c) => c.month === 12)!;
    expect(dec2025.total).toBe(2);
    expect(tasksRow2025.cells.find((c) => c.month === 1)!.total).toBe(0);

    // The 2026 board: the monthly blocks render Jan-Jul; December 2026 has no
    // annual block yet (its instance generates when the 2027-01-15 due date
    // arrives - the annual task never double-renders into the current year).
    const grid2026 = await getClientYearGrid(client.id, 2026, TEST_TODAY);
    const tasksRow2026 = grid2026!.rows.find((r) => r.stream === "tasks")!;
    for (let month = 1; month <= 7; month++) {
      expect(tasksRow2026.cells.find((c) => c.month === month)!.total).toBe(1);
    }
    expect(tasksRow2026.cells.find((c) => c.month === 12)!.total).toBe(0);
  });

  // The intake fixture helper stays honest: a converted intake links its client.
  it("reviewableIntake fixtures convert cleanly (sanity)", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Sanity Co",
      bookkeepingStartDate: "2026-08-01",
      formData: { serviceKeys: ["bank_feed_management"] },
    });
    const result = await convertIntakeToClient(intakeId, {}, ownerId, CONVERSION_TODAY);
    const intake = await getIntake(intakeId);
    expect(intake.clientId).toBe(result.clientId);
    expect(intake.status).toBe("completed");
  });
});
