import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

import { getAdminHubOverview } from "@/server/admin-reads";
import { seedDatabase } from "@/server/seed";

import { TEST_TODAY, dbReachable } from "./helpers";

/**
 * Phase 3C admin hub read: every stat is a real engine number against the
 * seeded database (purgatory queue, unread correspondence, vault slots,
 * statement queue, clock-in status, scheduler stamps, audit tail).
 */
const reachable = await dbReachable();

describe.skipIf(!reachable)("admin hub overview (Phase 3C)", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
  });

  it("assembles live stats from the seeded operational state", async () => {
    // Pin the clock inside the seeded day so firm-local "today" is stable.
    const now = new Date("2026-08-15T16:00:00.000Z"); // noon in America/New_York
    // The seed writes no audit rows; log one through the real engine so the
    // hub tail has something to carry.
    const { logEvent } = await import("@/server/audit");
    await logEvent({ userId: null, action: "hub_probe", entityType: "client", entityId: 1 });
    const overview = await getAdminHubOverview(now);

    expect(overview.pendingApprovals).toBeGreaterThanOrEqual(0);
    expect(overview.unreadClientReplies).toBeGreaterThanOrEqual(0);
    expect(overview.missingCredentials).toBeGreaterThanOrEqual(0);
    expect(overview.overdueStatements).toBeGreaterThanOrEqual(0);

    // Nobody has clocked in on the fresh seed: every active staff member is
    // absent, portal roles excluded.
    const staff = await db.select().from(users).where(eq(users.isActive, true));
    const staffCount = staff.filter((u) => !["client", "cpa"].includes(u.role.toLowerCase())).length;
    expect(overview.notClockedInToday.count).toBe(staffCount);
    expect(overview.notClockedInToday.names.length).toBe(staffCount);

    // Every scheduler job reports a stamp slot (never ran on a fresh seed).
    expect(overview.jobRuns.length).toBeGreaterThan(0);
    expect(overview.jobRuns.every((j) => j.lastRanAt === null)).toBe(true);
    expect(overview.jobRuns.map((j) => j.name)).toContain("missing-info-reminders");

    // The audit tail carries the probe event (newest first).
    expect(overview.recentAudit.length).toBeGreaterThan(0);
    expect(overview.recentAudit[0].action).toBe("hub_probe");
  });
});
