import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  accountReconciliations,
  accounts,
  clientReports,
  clients,
  tasks,
  users,
  weeklyBankFeeds,
} from "@/db/schema";
import {
  CapacityError,
  getStaffOpenWorkCounts,
  getTeamOverviewReport,
  tierKeyOf,
} from "@/server/capacity";
import { seedDatabase } from "@/server/seed";

import { TEST_TODAY, dbReachable } from "./helpers";

/**
 * G5 (02:20:15) team overview breakouts + E13 (01:15:16) the shared
 * open-work-count read behind the assignment surfaces.
 */

const reachable = await dbReachable();

// The G5 default filter: the week of TEST_TODAY (2026-08-15, Sat) - Mon..Sun.
const WEEK_FROM = "2026-08-10";
const WEEK_TO = "2026-08-16";

describe.skipIf(!reachable)("team overview (G5) + assignment workload (E13)", () => {
  let ownerId: number;
  let managerId: number;
  let bookkeeperId: number;
  let outsiderId: number; // a bookkeeper the fixture manager does not manage

  const clientIds: number[] = [];

  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    const byEmail = async (email: string) =>
      (await db.select().from(users).where(eq(users.email, email)).limit(1))[0].id;
    ownerId = await byEmail("mara@blueledgerbooks.com");
    outsiderId = await byEmail("jorge@blueledgerbooks.com");

    const [mgr] = await db
      .insert(users)
      .values({
        email: "g5-manager@firmos-test.local",
        firstName: "G5",
        lastName: "Manager",
        passwordHash: "x",
        role: "manager",
      })
      .returning();
    managerId = mgr.id;
    const [bk] = await db
      .insert(users)
      .values({
        email: "g5-bookkeeper@firmos-test.local",
        firstName: "G5",
        lastName: "Bookkeeper",
        passwordHash: "x",
        role: "bookkeeper",
        managerId: mgr.id,
      })
      .returning();
    bookkeeperId = bk.id;

    const [tier1Monthly, tier2Quarterly, untieredAnnual, paused] = await db
      .insert(clients)
      .values([
        {
          legalName: "G5 Tier 1 Monthly Co",
          tier: "1",
          bookkeepingFrequency: "monthly",
          bookkeeperId: bookkeeperId,
          managerId,
        },
        {
          legalName: "G5 Tier 2 Quarterly Co",
          tier: "Tier 2",
          bookkeepingFrequency: "quarterly",
          bookkeeperId,
          managerId,
        },
        {
          legalName: "G5 Untiered Annual Co",
          bookkeepingFrequency: "annual",
          bookkeeperId,
          managerId,
        },
        {
          legalName: "G5 Paused Co",
          tier: "3",
          bookkeepingFrequency: "monthly",
          bookkeeperId,
          isPaused: true,
        },
      ])
      .returning();
    clientIds.push(...[tier1Monthly, tier2Quarterly, untieredAnnual, paused].map((c) => c.id));

    // In-range work for the bookkeeper: one done task + one open feed on the
    // tier-1 monthly client; one open recon on the tier-2 quarterly client.
    await db.insert(tasks).values({
      clientId: tier1Monthly.id,
      title: "G5 done in-range task",
      taskType: "ad_hoc",
      status: "completed",
      dueDate: "2026-08-12",
      completedAt: new Date(),
      assigneeId: bookkeeperId,
    });
    await db.insert(weeklyBankFeeds).values({
      clientId: tier1Monthly.id,
      weekStartDate: "2026-08-10",
      weekEndDate: "2026-08-16",
      dueDate: "2026-08-14",
      attributedYear: 2026,
      attributedMonth: 8,
    });
    const [acct] = await db
      .insert(accounts)
      .values({
        clientId: tier2Quarterly.id,
        name: "Operating",
        accountType: "checking",
        statementDay: 31,
      })
      .returning();
    await db.insert(accountReconciliations).values({
      accountId: acct.id,
      clientId: tier2Quarterly.id,
      attributedYear: 2026,
      attributedMonth: 8,
      dueDate: "2026-08-13",
    });
    // In-range completed report on the untiered annual client (manager's card).
    await db.insert(clientReports).values({
      clientId: untieredAnnual.id,
      name: "Annual review",
      attributedYear: 2026,
      attributedMonth: 8,
      dueDate: "2026-08-15",
      completedAt: new Date(),
    });
    // Out-of-range open task (excluded from the overview, counted in workload).
    await db.insert(tasks).values({
      clientId: tier1Monthly.id,
      title: "G5 open next-week task",
      taskType: "ad_hoc",
      status: "open",
      dueDate: "2026-08-20",
      assigneeId: bookkeeperId,
    });
    // Paused-client open work: invisible everywhere (§6.2).
    await db.insert(tasks).values({
      clientId: paused.id,
      title: "G5 paused-client task",
      taskType: "ad_hoc",
      status: "open",
      dueDate: "2026-08-12",
      assigneeId: bookkeeperId,
    });
  });

  afterAll(async () => {
    // Fixtures are unique-named rows; clear them so reruns stay isolated.
    await db.delete(tasks).where(inArray(tasks.clientId, clientIds));
    await db.delete(clientReports).where(inArray(clientReports.clientId, clientIds));
    const acctRows = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(inArray(accounts.clientId, clientIds));
    if (acctRows.length > 0) {
      await db
        .delete(accountReconciliations)
        .where(inArray(accountReconciliations.accountId, acctRows.map((a) => a.id)));
    }
    await db.delete(accounts).where(inArray(accounts.clientId, clientIds));
    await db.delete(weeklyBankFeeds).where(inArray(weeklyBankFeeds.clientId, clientIds));
    await db.delete(clients).where(inArray(clients.id, clientIds));
    for (const id of [managerId, bookkeeperId]) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  it("tierKeyOf normalizes the legacy tier text column to 1/2/3/untiered", () => {
    expect(tierKeyOf("1")).toBe("1");
    expect(tierKeyOf("Tier 2")).toBe("2");
    expect(tierKeyOf("tier_3")).toBe("3");
    expect(tierKeyOf(null)).toBe("untiered");
    expect(tierKeyOf("premium")).toBe("untiered");
  });

  it("rejects bookkeepers", async () => {
    await expect(
      getTeamOverviewReport({
        requesterId: bookkeeperId,
        requesterRole: "bookkeeper",
        fromIso: WEEK_FROM,
        toIso: WEEK_TO,
      }),
    ).rejects.toThrow(CapacityError);
  });

  it("breaks per-person completion out by client tier and cadence", async () => {
    const report = await getTeamOverviewReport({
      requesterId: ownerId,
      requesterRole: "owner",
      fromIso: WEEK_FROM,
      toIso: WEEK_TO,
    });
    expect(report.scope).toBe("all_staff");
    expect(report.fromIso).toBe(WEEK_FROM);

    const bk = report.rows.find((r) => r.userId === bookkeeperId)!;
    // In-range: done task + open feed (tier 1 monthly), open recon (tier 2 quarterly).
    expect(bk.totals).toEqual({ done: 1, total: 3 });
    expect(bk.byTier["1"]).toEqual({ done: 1, total: 2 });
    expect(bk.byTier["2"]).toEqual({ done: 0, total: 1 });
    expect(bk.byTier["3"]).toEqual({ done: 0, total: 0 }); // paused client excluded
    expect(bk.byCadence.monthly).toEqual({ done: 1, total: 2 });
    expect(bk.byCadence.quarterly).toEqual({ done: 0, total: 1 });
    expect(bk.byCadence.annual).toEqual({ done: 0, total: 0 });

    const mgr = report.rows.find((r) => r.userId === managerId)!;
    // The completed annual-client report is the manager's card.
    expect(mgr.totals).toEqual({ done: 1, total: 1 });
    expect(mgr.byTier.untiered).toEqual({ done: 1, total: 1 });
    expect(mgr.byCadence.annual).toEqual({ done: 1, total: 1 });
  });

  it("scopes a manager to themselves plus their direct reports", async () => {
    const report = await getTeamOverviewReport({
      requesterId: managerId,
      requesterRole: "manager",
      fromIso: WEEK_FROM,
      toIso: WEEK_TO,
    });
    expect(report.scope).toBe("direct_reports");
    const ids = report.rows.map((r) => r.userId).sort((a, b) => a - b);
    expect(ids).toEqual([managerId, bookkeeperId].sort((a, b) => a - b));
    expect(ids).not.toContain(outsiderId);
  });

  it("the E13 workload read: open assigned work per staff, batched, paused excluded", async () => {
    const counts = await getStaffOpenWorkCounts();
    // Every active STAFF member appears, including zero-load ones (portal
    // roles never do).
    const staff = (await db.select().from(users).where(eq(users.isActive, true))).filter((u) =>
      ["owner", "admin", "manager", "bookkeeper"].includes(u.role.toLowerCase()),
    );
    expect(counts.length).toBe(staff.length);

    const bk = counts.find((c) => c.userId === bookkeeperId)!;
    // Open: the in-range feed + in-range recon + the next-week task. The done
    // task and the paused client's task never count.
    expect(bk.openCount).toBe(3);

    const zero = counts.find((c) => c.userId === outsiderId);
    expect(zero).toBeDefined();
    expect(Number.isInteger(zero!.openCount)).toBe(true);
  });
});
