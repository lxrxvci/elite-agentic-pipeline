import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LocalDate, Month } from "@firmos/domain";

import { db } from "@/db";
import { accounts, clients, users } from "@/db/schema";
import { uploadStatement } from "@/server/documents";
import { seedDatabase } from "@/server/seed";
import { __resetStorageForTests } from "@/server/storage";
import {
  deferAccountStatements,
  getStatementQueue,
  getStatementsGrid,
  getTransactionDownloadQueue,
  markTransactionsDownloaded,
  requiredStartMonth,
  statementStatusForAccount,
  type StatementClientInput,
} from "@/server/statements";

import { TEST_TODAY, dbReachable } from "./helpers";

const reachable = await dbReachable();

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

/** Harborline-like monthly client, close tier 5, books from Jan 2026. */
const MONTHLY_CLIENT: StatementClientInput = {
  bookkeepingFrequency: "monthly",
  monthlyCloseTier: "5",
  bookkeepingStartDate: "2026-01-01",
};

const DAY_31_ACCOUNT = { statementDay: 31, openDate: "2026-01-01" };

function months(range: [number, number][]): Month[] {
  return range.map(([year, month]) => ({ year, month }));
}

// ── statementStatusForAccount (§6.7) - pure math ──────────────────────────

describe("statementStatusForAccount (§6.7)", () => {
  it("counts released-and-unuploaded months as missing, from the required start", () => {
    const status = statementStatusForAccount(DAY_31_ACCOUNT, MONTHLY_CLIENT, [], TEST_TODAY);
    // Releases Jan 31 .. Jul 31 have all passed by 2026-08-15; August has not.
    expect(status.missingCount).toBe(7);
    expect(status.earliestMissingPeriod).toEqual({ year: 2026, month: 1 });
    expect(status.earliestMissingDate).toBe("2026-01-31");
    expect(status.nextPeriod).toEqual({ year: 2026, month: 1 });
    expect(status.nextStatementDate).toBe("2026-01-31");
    expect(status.isOverdue).toBe(true);
  });

  it("§29 fix: a month is not missing before its release date passes", () => {
    const beforeRelease: LocalDate = { year: 2026, month: 7, day: 30 };
    const status = statementStatusForAccount(DAY_31_ACCOUNT, MONTHLY_CLIENT, [], beforeRelease);
    // July's statement releases Jul 31 - not yet passed, so Jan..Jun only.
    expect(status.missingCount).toBe(6);
    expect(status.earliestMissingDate).toBe("2026-01-31");
    expect(status.isOverdue).toBe(true);

    // On the release day itself the month still is not missing.
    const onRelease: LocalDate = { year: 2026, month: 7, day: 31 };
    const same = statementStatusForAccount(DAY_31_ACCOUNT, MONTHLY_CLIENT, [], onRelease);
    expect(same.missingCount).toBe(6);
  });

  it("with no gaps, next is the next future release and nothing is overdue", () => {
    const uploaded = months([
      [2026, 1],
      [2026, 2],
      [2026, 3],
      [2026, 4],
      [2026, 5],
      [2026, 6],
      [2026, 7],
    ]);
    const status = statementStatusForAccount(DAY_31_ACCOUNT, MONTHLY_CLIENT, uploaded, TEST_TODAY);
    expect(status.missingCount).toBe(0);
    expect(status.earliestMissingDate).toBeNull();
    expect(status.nextPeriod).toEqual({ year: 2026, month: 8 });
    expect(status.nextStatementDate).toBe("2026-08-31");
    expect(status.isOverdue).toBe(false);
  });

  it("a mid-month statement day before the cutoff releases the following month", () => {
    // Payroll Checking shape: day 3 < tier cutoff 5 -> July's statement
    // releases Aug 3, which has passed by Aug 15.
    const status = statementStatusForAccount(
      { statementDay: 3, openDate: "2026-01-01" },
      MONTHLY_CLIENT,
      [],
      TEST_TODAY,
    );
    expect(status.missingCount).toBe(7);
    expect(status.earliestMissingDate).toBe("2026-02-03");
  });

  it("deferral suppresses overdue but never erases the missing count", () => {
    const deferred = statementStatusForAccount(
      DAY_31_ACCOUNT,
      MONTHLY_CLIENT,
      [],
      TEST_TODAY,
      "2026-09-01",
    );
    expect(deferred.isDeferred).toBe(true);
    expect(deferred.isOverdue).toBe(false);
    expect(deferred.missingCount).toBe(7);

    // A lapsed deferral no longer suppresses anything.
    const lapsed = statementStatusForAccount(
      DAY_31_ACCOUNT,
      MONTHLY_CLIENT,
      [],
      TEST_TODAY,
      "2026-08-01",
    );
    expect(lapsed.isDeferred).toBe(false);
    expect(lapsed.isOverdue).toBe(true);
  });

  it("required start is the later of client start, account open, and Jan 1", () => {
    // Account opened mid-year: months before opening are never required.
    const openedLate = statementStatusForAccount(
      { statementDay: 31, openDate: "2026-04-10" },
      MONTHLY_CLIENT,
      [],
      TEST_TODAY,
    );
    expect(openedLate.missingCount).toBe(4); // Apr..Jul
    expect(openedLate.earliestMissingPeriod).toEqual({ year: 2026, month: 4 });

    // Old start dates are floored at Jan 1 of the current year (§6.7).
    const legacy: StatementClientInput = { ...MONTHLY_CLIENT, bookkeepingStartDate: "2025-06-01" };
    expect(requiredStartMonth({ statementDay: 31, openDate: "2025-06-01" }, legacy, TEST_TODAY)).toEqual(
      { year: 2026, month: 1 },
    );

    // The intake fallback supplies the start when the client row has none.
    const fallback: StatementClientInput = {
      ...MONTHLY_CLIENT,
      bookkeepingStartDate: null,
      intakeBookkeepingStartDate: "2026-03-01",
    };
    expect(requiredStartMonth(DAY_31_ACCOUNT, fallback, TEST_TODAY)).toEqual({
      year: 2026,
      month: 3,
    });
  });
});

// ── DB-backed queue + grid (§14) ──────────────────────────────────────────

describe.skipIf(!reachable)("statements engine (DB-backed)", () => {
  let docsRootTmp = "";

  beforeAll(async () => {
    docsRootTmp = mkdtempSync(path.join(tmpdir(), "firmos-docs-stmt-"));
    process.env.FIRMOS_DOCS_ROOT = docsRootTmp;
    __resetStorageForTests();
    await seedDatabase(TEST_TODAY);
  });

  afterAll(() => {
    if (docsRootTmp) rmSync(docsRootTmp, { recursive: true, force: true });
    delete process.env.FIRMOS_DOCS_ROOT;
    __resetStorageForTests();
  });

  async function clientByName(legalName: string) {
    const [row] = await db.select().from(clients).where(eq(clients.legalName, legalName)).limit(1);
    if (!row) throw new Error(`seeded client not found: ${legalName}`);
    return row;
  }

  async function accountByName(clientId: number, name: string) {
    const rows = await db.select().from(accounts).where(eq(accounts.clientId, clientId));
    const row = rows.find((a) => a.name === name);
    if (!row) throw new Error(`seeded account not found: ${name}`);
    return row;
  }

  it("queue excludes on-hold clients, project-only clients, and no-statement-day accounts", async () => {
    const queue = await getStatementQueue(TEST_TODAY);
    const names = queue.map((r) => `${r.clientName} / ${r.accountName}`);

    // Redwood Pediatric Therapy is paused; Summit Peak Builders is
    // project-only with no active project; Owner Draws has no statement_day.
    expect(names.some((n) => n.includes("Redwood Pediatric Therapy"))).toBe(false);
    expect(names.some((n) => n.includes("Summit Peak Builders"))).toBe(false);
    expect(names.some((n) => n.includes("Owner Draws"))).toBe(false);

    const harborlineChecking = queue.find(
      (r) => r.clientName === "Harborline Marine Supply" && r.accountName === "Operating Checking",
    );
    expect(harborlineChecking).toBeDefined();
    expect(harborlineChecking!.status.missingCount).toBe(7);
    expect(harborlineChecking!.status.isOverdue).toBe(true);
    expect(harborlineChecking!.status.earliestMissingDate).toBe("2026-01-31");
    expect(harborlineChecking!.status.nextPeriod).toEqual({ year: 2026, month: 1 });
  });

  it("upload -> grid cell appears, and the queue catches up (round-trip)", async () => {
    const blueSpruce = await clientByName("Blue Spruce Landscaping");
    const mainChecking = await accountByName(blueSpruce.id, "Main Checking");
    const [mara] = await db.select().from(users).where(eq(users.role, "owner")).limit(1);

    const uploaded = await uploadStatement({
      accountId: mainChecking.id,
      uploadedById: mara.id,
      fileName: "june.pdf",
      mimeType: "application/pdf",
      bytes: PDF_BYTES,
      statementDate: "2026-06-30",
      today: TEST_TODAY,
    });
    expect(uploaded.period).toEqual({ year: 2026, month: 6 });

    const grid = await getStatementsGrid(blueSpruce.id, TEST_TODAY);
    const accountGrid = grid.accounts.find((a) => a.accountId === mainChecking.id)!;
    expect(accountGrid.cells).toHaveLength(8); // Jan..Aug 2026
    const june = accountGrid.cells.find((c) => c.year === 2026 && c.month === 6)!;
    expect(june.state).toBe("uploaded");
    expect(june.documentId).toBe(uploaded.document.id);

    const july = accountGrid.cells.find((c) => c.year === 2026 && c.month === 7)!;
    expect(july.state).toBe("missing"); // released Jul 31, before today
    const august = accountGrid.cells.find((c) => c.year === 2026 && c.month === 8)!;
    expect(august.state).toBe("future"); // releases Aug 31, not yet passed (§29)

    const queue = await getStatementQueue(TEST_TODAY);
    const row = queue.find((r) => r.accountId === mainChecking.id)!;
    expect(row.status.missingCount).toBe(6); // was 7 before the upload
    expect(row.status.earliestMissingDate).toBe("2026-01-31");
  });

  it("grid cells carry the ending balance and statement date captured at upload", async () => {
    const blueSpruce = await clientByName("Blue Spruce Landscaping");
    const mainChecking = await accountByName(blueSpruce.id, "Main Checking");
    const [mara] = await db.select().from(users).where(eq(users.role, "owner")).limit(1);

    // June's statement exists from the round-trip test above; re-uploading
    // with a balance updates that row in place.
    const uploaded = await uploadStatement({
      accountId: mainChecking.id,
      uploadedById: mara.id,
      fileName: "june-with-balance.pdf",
      mimeType: "application/pdf",
      bytes: PDF_BYTES,
      statementDate: "2026-06-30",
      endingBalance: "12408.22",
      today: TEST_TODAY,
    });
    expect(uploaded.period).toEqual({ year: 2026, month: 6 });
    expect(uploaded.updatedInPlace).toBe(true);

    const grid = await getStatementsGrid(blueSpruce.id, TEST_TODAY);
    const accountGrid = grid.accounts.find((a) => a.accountId === mainChecking.id)!;
    const june = accountGrid.cells.find((c) => c.year === 2026 && c.month === 6)!;
    expect(june.state).toBe("uploaded");
    expect(june.endingBalance).toBe("12408.22");
    expect(june.statementDate).toBe("2026-06-30");

    // Months without a document stay null on both new fields.
    const july = accountGrid.cells.find((c) => c.year === 2026 && c.month === 7)!;
    expect(july.endingBalance).toBeNull();
    expect(july.statementDate).toBeNull();
  });

  it("grid marks months before the account open date as before_start", async () => {
    const blueSpruce = await clientByName("Blue Spruce Landscaping");
    const [inserted] = await db
      .insert(accounts)
      .values({
        clientId: blueSpruce.id,
        name: "New Money Market",
        accountType: "checking",
        statementDay: 31,
        openDate: "2026-04-10",
      })
      .returning();

    const grid = await getStatementsGrid(blueSpruce.id, TEST_TODAY);
    const accountGrid = grid.accounts.find((a) => a.accountId === inserted.id)!;
    const states = new Map(accountGrid.cells.map((c) => [c.month, c.state]));
    expect(states.get(1)).toBe("before_start");
    expect(states.get(2)).toBe("before_start");
    expect(states.get(3)).toBe("before_start");
    expect(states.get(4)).toBe("missing");
    expect(states.get(8)).toBe("future");
  });

  it("deferral flips queue rows to not-overdue and grid cells to deferred", async () => {
    const copperline = await clientByName("Copperline Coffee Roasters");
    const operating = await accountByName(copperline.id, "Operating");

    await deferAccountStatements(operating.id, "2026-09-30");

    const queue = await getStatementQueue(TEST_TODAY);
    const row = queue.find((r) => r.accountId === operating.id)!;
    expect(row.status.isOverdue).toBe(false);
    expect(row.status.isDeferred).toBe(true);
    expect(row.status.missingCount).toBe(7);

    const grid = await getStatementsGrid(copperline.id, TEST_TODAY);
    const accountGrid = grid.accounts.find((a) => a.accountId === operating.id)!;
    const jan = accountGrid.cells.find((c) => c.month === 1)!;
    expect(jan.state).toBe("deferred");

    // Clearing the deferral restores overdue.
    await deferAccountStatements(operating.id, null);
    const restored = (await getStatementQueue(TEST_TODAY)).find(
      (r) => r.accountId === operating.id,
    )!;
    expect(restored.status.isOverdue).toBe(true);
  });

  it("manual-transactions queue: flagged accounts appear, mark moves the next date", async () => {
    const northwind = await clientByName("Northwind Frame & Door");
    const checking = await accountByName(northwind.id, "Checking");

    // Not flagged yet: absent from the queue.
    let txQueue = await getTransactionDownloadQueue(TEST_TODAY);
    expect(txQueue.some((r) => r.accountId === checking.id)).toBe(false);

    await db
      .update(accounts)
      .set({ requiresManualTransactions: true })
      .where(eq(accounts.id, checking.id));

    txQueue = await getTransactionDownloadQueue(TEST_TODAY);
    const row = txQueue.find((r) => r.accountId === checking.id)!;
    expect(row.lastTransactionsDownloadedAt).toBeNull();
    expect(row.isDue).toBe(true);

    await markTransactionsDownloaded(checking.id, "2026-08-15");
    txQueue = await getTransactionDownloadQueue(TEST_TODAY);
    const marked = txQueue.find((r) => r.accountId === checking.id)!;
    expect(marked.lastTransactionsDownloadedAt).toBe("2026-08-15");
    expect(marked.nextDueDate).toBe("2026-08-16");
    expect(marked.isDue).toBe(false);
  });
});
