import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  parseLocalDate,
  reconciliationDueDate,
  statementReleaseDate,
} from "@firmos/domain";

import { db } from "@/db";
import {
  accountReconciliations,
  accounts,
  clientReports,
  clients,
  tasks,
  weeklyBankFeeds,
} from "@/db/schema";
import { materializeOperationalRows } from "@/server/materialize";
import { runRecurringOnce } from "@/server/recurring";
import { seedDatabase } from "@/server/seed";

import { TEST_CATCHUP, TEST_TODAY, clientIdByName, dbReachable } from "./helpers";

const reachable = await dbReachable();

async function tableCounts() {
  const countOf = async (
    t:
      | typeof weeklyBankFeeds
      | typeof accountReconciliations
      | typeof clientReports
      | typeof tasks,
  ) =>
    Number(
      (await db.select({ n: sql<number>`count(*)` }).from(t as typeof weeklyBankFeeds))[0].n,
    );
  return {
    feeds: await countOf(weeklyBankFeeds),
    recons: await countOf(accountReconciliations),
    reports: await countOf(clientReports),
    tasks: await countOf(tasks),
  };
}

describe.skipIf(!reachable)("materializeOperationalRows", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
  });

  it("is idempotent: re-running materialize + recurring changes no row counts", async () => {
    const before = await tableCounts();
    const m = await materializeOperationalRows(TEST_TODAY);
    const r = await runRecurringOnce(TEST_TODAY);
    const after = await tableCounts();

    expect(m.failures).toEqual([]);
    expect(m.bankFeedsCreated).toBe(0);
    expect(m.reconciliationsCreated).toBe(0);
    expect(m.reportsCreated).toBe(0);
    expect(r.tasksCreated).toBe(0);
    expect(after).toEqual(before);
  });

  it("re-seeding twice lands on identical counts (unique constraints hold, no violations)", async () => {
    const first = await seedDatabase(TEST_TODAY);
    const second = await seedDatabase(TEST_TODAY);
    expect(second).toEqual(first);
  });

  it("skips paused and project clients entirely", async () => {
    const allClients = await db.select().from(clients);
    const pausedId = clientIdByName(allClients, "Redwood Pediatric Therapy");
    const projectId = clientIdByName(allClients, "Summit Peak Builders");

    const feeds = await db.select().from(weeklyBankFeeds);
    const recons = await db.select().from(accountReconciliations);
    const reports = await db.select().from(clientReports);
    for (const id of [pausedId, projectId]) {
      expect(feeds.some((f) => f.clientId === id)).toBe(false);
      expect(recons.some((r) => r.clientId === id)).toBe(false);
      expect(reports.some((r) => r.clientId === id)).toBe(false);
    }
  });

  it("floors early bank-feed due dates at the catch-up date without collapsing attribution", async () => {
    const allClients = await db.select().from(clients);
    const harborline = clientIdByName(allClients, "Harborline Marine Supply");
    const feeds = await db
      .select()
      .from(weeklyBankFeeds)
      .where(eq(weeklyBankFeeds.clientId, harborline));

    expect(feeds.length).toBeGreaterThan(40);
    const floored = feeds.filter((f) => f.dueDate === TEST_CATCHUP);
    expect(floored.length).toBeGreaterThan(10);
    // The floored rows must NOT all collapse into one attributed month -
    // attribution comes from the un-floored due date (§6.1).
    const periods = new Set(floored.map((f) => `${f.attributedYear}-${f.attributedMonth}`));
    expect(periods.size).toBeGreaterThan(3);
    for (const f of feeds) {
      expect(f.dueDate! >= TEST_CATCHUP).toBe(true);
    }
  });

  it("computes reconciliation statement_date/due_date exactly as the domain, for month-end and mid-month accounts", async () => {
    const allClients = await db.select().from(clients);
    const harborline = clientIdByName(allClients, "Harborline Marine Supply");
    const harborlineAccounts = await db
      .select()
      .from(accounts)
      .where(eq(accounts.clientId, harborline));
    expect(harborlineAccounts).toHaveLength(3);

    const catchup = parseLocalDate(TEST_CATCHUP);
    const tier = 5 as const; // Harborline is monthly close tier 5.

    for (const account of harborlineAccounts) {
      const rows = await db
        .select()
        .from(accountReconciliations)
        .where(
          and(
            eq(accountReconciliations.accountId, account.id),
            eq(accountReconciliations.attributedYear, TEST_TODAY.year),
          ),
        );
      expect(rows).toHaveLength(12);
      for (const row of rows) {
        const expectedStatement = statementReleaseDate(
          account.statementDay,
          row.attributedYear,
          row.attributedMonth,
          tier,
        );
        const expectedDue = reconciliationDueDate(
          { year: row.attributedYear, month: row.attributedMonth },
          expectedStatement,
          tier,
          catchup,
        );
        const pad = (n: number) => String(n).padStart(2, "0");
        expect(row.statementDate).toBe(
          `${expectedStatement.year}-${pad(expectedStatement.month)}-${pad(expectedStatement.day)}`,
        );
        expect(row.dueDate).toBe(
          `${expectedDue.year}-${pad(expectedDue.month)}-${pad(expectedDue.day)}`,
        );
      }
    }

    // Spot-check the interesting shapes explicitly.
    const byName = new Map(harborlineAccounts.map((a) => [a.name, a.id]));
    const rowFor = async (name: string, month: number) =>
      (
        await db
          .select()
          .from(accountReconciliations)
          .where(
            and(
              eq(accountReconciliations.accountId, byName.get(name)!),
              eq(accountReconciliations.attributedYear, 2026),
              eq(accountReconciliations.attributedMonth, month),
            ),
          )
      )[0];

    // Month-end account: statement on the last day of the accounting month.
    expect((await rowFor("Operating Checking", 3)).statementDate).toBe("2026-03-31");
    // Mid-month day 20 ≥ cutoff 5: statement issued the 20th of its own month.
    expect((await rowFor("Business Credit Card", 3)).statementDate).toBe("2026-03-20");
    // Day 3 < cutoff 5: covers the prior month, issued the 3rd of the NEXT month.
    expect((await rowFor("Payroll Checking", 3)).statementDate).toBe("2026-04-03");
    // Due = max(statement + 8d, tier day) - Payroll: max(Apr 11, Apr 5), floored to catch-up.
    expect((await rowFor("Payroll Checking", 3)).dueDate).toBe(TEST_CATCHUP);
    // July Payroll: max(Jul 11? statement Aug 3 + 8 = Aug 11, tier Aug 5) = Aug 11 (past catch-up).
    expect((await rowFor("Payroll Checking", 7)).statementDate).toBe("2026-08-03");
    expect((await rowFor("Payroll Checking", 7)).dueDate).toBe("2026-08-11");
  });

  it("materializes report rows from intake form_data definitions by frequency", async () => {
    const allClients = await db.select().from(clients);
    const harborline = clientIdByName(allClients, "Harborline Marine Supply");
    const copperline = clientIdByName(allClients, "Copperline Coffee Roasters");
    const northwind = clientIdByName(allClients, "Northwind Frame & Door");

    const reportsFor = async (id: number) =>
      db.select().from(clientReports).where(eq(clientReports.clientId, id));

    const a = await reportsFor(harborline);
    expect(a.filter((r) => r.name === "Monthly Financial Package")).toHaveLength(12);
    expect(a.filter((r) => r.name === "Quarterly Tax Summary").map((r) => r.attributedMonth)).toEqual([
      3, 6, 9, 12,
    ]);
    expect(
      (await reportsFor(copperline)).map((r) => r.attributedMonth),
    ).toEqual([3, 6, 9, 12]);
    expect(await reportsFor(northwind)).toHaveLength(1);
  });
});
