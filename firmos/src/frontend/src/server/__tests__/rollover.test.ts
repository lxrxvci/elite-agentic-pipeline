import { beforeAll, describe, expect, it } from "vitest";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  accountReconciliations,
  clientReports,
  clients,
  tasks,
  users,
  weeklyBankFeeds,
  workstationTimeEntries,
} from "@/db/schema";
import { seedDatabase } from "@/server/seed";
import { clockIn, getClockStatus, startActivity } from "@/server/time-tracking";
import { applyRolloverDecisions, setBankFeedCompleted } from "@/server/work-items";

import { TEST_TODAY, clientIdByName, dbReachable } from "./helpers";

/**
 * D3 guided rollover (anti-overwhelm): the batch decision engine behind the
 * morning dialog. Pins the per-kind support matrix (feeds defer+wait, tasks
 * wait via status, recons/reports re-anchor only), the re-anchor semantics
 * (deferred_until=today for feeds, due_date=today for the rest), defer-date
 * validation, the assignment scope, and the completed-row guard.
 *
 * D5 stop-on-complete: completing a periodic row closes the user's matching
 * activity timer (the periodic counterpart of completeTask's task-timer
 * stop).
 */

const reachable = await dbReachable();

describe.skipIf(!reachable)("applyRolloverDecisions (D3)", () => {
  let jorgeId: number;
  let sofiaId: number;
  let harborlineId: number;
  let blueSpruceId: number;

  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    const allUsers = await db.select().from(users);
    jorgeId = allUsers.find((u) => u.email === "jorge@blueledgerbooks.com")!.id;
    sofiaId = allUsers.find((u) => u.email === "sofia@blueledgerbooks.com")!.id;
    const allClients = await db.select().from(clients);
    harborlineId = clientIdByName(allClients, "Harborline Marine Supply"); // bookkeeper: Jorge
    blueSpruceId = clientIdByName(allClients, "Blue Spruce Landscaping"); // bookkeeper: Sofia
  });

  /** A seeded feed row for the client, reset to open/overdue for the test. */
  async function grabFeed(clientId: number): Promise<number> {
    const [row] = await db
      .select()
      .from(weeklyBankFeeds)
      .where(eq(weeklyBankFeeds.clientId, clientId))
      .limit(1);
    expect(row).toBeDefined();
    await db
      .update(weeklyBankFeeds)
      .set({
        completedAt: null,
        completedById: null,
        waitingOnClient: false,
        deferredUntil: null,
        dueDate: "2026-08-14",
        updatedAt: new Date(),
      })
      .where(eq(weeklyBankFeeds.id, row.id));
    return row.id;
  }

  async function makeTask(clientId: number, assigneeId: number): Promise<number> {
    const [row] = await db
      .insert(tasks)
      .values({
        clientId,
        assigneeId,
        title: `Rollover test task ${Date.now()}`,
        taskType: "ad_hoc",
        status: "open",
        dueDate: "2026-08-14",
      })
      .returning();
    return row.id;
  }

  it("re-anchors a feed to today via deferred_until (never touching due_date)", async () => {
    const id = await grabFeed(harborlineId);
    const result = await applyRolloverDecisions(
      jorgeId,
      [{ kind: "bank_feed", id, action: "today" }],
      TEST_TODAY,
    );
    expect(result.applied).toHaveLength(1);
    const [row] = await db.select().from(weeklyBankFeeds).where(eq(weeklyBankFeeds.id, id));
    expect(row.deferredUntil).toBe("2026-08-15");
    expect(row.dueDate).toBe("2026-08-14");
  });

  it("defers a feed to a picked date; rejects a past date", async () => {
    const good = await grabFeed(harborlineId);
    const bad = await grabFeed(harborlineId);
    const result = await applyRolloverDecisions(
      jorgeId,
      [
        { kind: "bank_feed", id: good, action: "defer", until: "2026-08-20" },
        { kind: "bank_feed", id: bad, action: "defer", until: "2026-08-01" },
      ],
      TEST_TODAY,
    );
    expect(result.applied.map((d) => d.id)).toEqual([good]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toMatch(/past/);
    const [row] = await db.select().from(weeklyBankFeeds).where(eq(weeklyBankFeeds.id, good));
    expect(row.deferredUntil).toBe("2026-08-20");
  });

  it("parks a feed waiting on client", async () => {
    const id = await grabFeed(harborlineId);
    await applyRolloverDecisions(
      jorgeId,
      [{ kind: "bank_feed", id, action: "waiting_on_client" }],
      TEST_TODAY,
    );
    const [row] = await db.select().from(weeklyBankFeeds).where(eq(weeklyBankFeeds.id, id));
    expect(row.waitingOnClient).toBe(true);
  });

  it("tasks: waiting via status, re-anchor via due_date, defer unsupported", async () => {
    const waitId = await makeTask(harborlineId, jorgeId);
    const todayId = await makeTask(harborlineId, jorgeId);
    const deferId = await makeTask(harborlineId, jorgeId);
    const result = await applyRolloverDecisions(
      jorgeId,
      [
        { kind: "task", id: waitId, action: "waiting_on_client" },
        { kind: "task", id: todayId, action: "today" },
        { kind: "task", id: deferId, action: "defer", until: "2026-08-20" },
      ],
      TEST_TODAY,
    );
    expect(result.applied.map((d) => d.id).sort()).toEqual([waitId, todayId].sort());
    expect(result.skipped[0].reason).toMatch(/does not support/);
    const rows = await db.select().from(tasks).where(eq(tasks.id, waitId));
    expect(rows[0].status).toBe("waiting_on_client");
    const todayRows = await db.select().from(tasks).where(eq(tasks.id, todayId));
    expect(todayRows[0].dueDate).toBe("2026-08-15");
  });

  it("reconciliations and reports re-anchor to today only", async () => {
    const allUsers = await db.select().from(users);
    const danaId = allUsers.find((u) => u.email === "dana@blueledgerbooks.com")!.id;
    const [recon] = await db
      .select()
      .from(accountReconciliations)
      .where(
        and(
          eq(accountReconciliations.clientId, harborlineId),
          isNull(accountReconciliations.completedAt),
        ),
      )
      .limit(1);
    const [report] = await db
      .select()
      .from(clientReports)
      .where(and(eq(clientReports.clientId, harborlineId), isNull(clientReports.completedAt)))
      .limit(1);
    expect(recon).toBeDefined();
    expect(report).toBeDefined();

    // Recons follow the client's bookkeeper (Jorge), reports its manager
    // (Dana) - the same assignment derivation the queue uses.
    const reconResult = await applyRolloverDecisions(
      jorgeId,
      [
        { kind: "reconciliation", id: recon.id, action: "today" },
        { kind: "reconciliation", id: recon.id, action: "waiting_on_client" },
      ],
      TEST_TODAY,
    );
    expect(reconResult.applied).toHaveLength(1);
    expect(reconResult.skipped).toHaveLength(1);

    const reportResult = await applyRolloverDecisions(
      danaId,
      [
        { kind: "report", id: report.id, action: "today" },
        { kind: "report", id: report.id, action: "defer", until: "2026-08-20" },
      ],
      TEST_TODAY,
    );
    expect(reportResult.applied).toHaveLength(1);
    expect(reportResult.skipped).toHaveLength(1);

    const [r1] = await db
      .select()
      .from(accountReconciliations)
      .where(eq(accountReconciliations.id, recon.id));
    expect(r1.dueDate).toBe("2026-08-15");
    expect(r1.waitingOnClient).toBe(false);
    const [r2] = await db.select().from(clientReports).where(eq(clientReports.id, report.id));
    expect(r2.dueDate).toBe("2026-08-15");
  });

  it("skips items not assigned to the deciding user", async () => {
    // Blue Spruce's bookkeeper is Sofia; Jorge cannot roll its feed.
    const feedId = await grabFeed(blueSpruceId);
    const taskId = await makeTask(harborlineId, sofiaId);
    const result = await applyRolloverDecisions(
      jorgeId,
      [
        { kind: "bank_feed", id: feedId, action: "today" },
        { kind: "task", id: taskId, action: "today" },
      ],
      TEST_TODAY,
    );
    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped[0].reason).toMatch(/Not assigned/);
    const [row] = await db.select().from(weeklyBankFeeds).where(eq(weeklyBankFeeds.id, feedId));
    expect(row.deferredUntil).toBeNull();
  });

  it("skips completed rows", async () => {
    const id = await grabFeed(harborlineId);
    await db
      .update(weeklyBankFeeds)
      .set({ completedAt: new Date(), completedById: jorgeId })
      .where(eq(weeklyBankFeeds.id, id));
    const result = await applyRolloverDecisions(
      jorgeId,
      [{ kind: "bank_feed", id, action: "today" }],
      TEST_TODAY,
    );
    expect(result.applied).toHaveLength(0);
    expect(result.skipped[0].reason).toMatch(/complete/);
  });
});

describe.skipIf(!reachable)("D5 - completing a periodic card stops its activity timer", () => {
  it("closes the matching open activity entry on bank-feed completion", async () => {
    await seedDatabase(TEST_TODAY);
    const allUsers = await db.select().from(users);
    const jorgeId = allUsers.find((u) => u.email === "jorge@blueledgerbooks.com")!.id;
    const allClients = await db.select().from(clients);
    const harborlineId = clientIdByName(allClients, "Harborline Marine Supply");

    // An open feed row for the client.
    const [feed] = await db
      .select()
      .from(weeklyBankFeeds)
      .where(
        and(eq(weeklyBankFeeds.clientId, harborlineId), isNull(weeklyBankFeeds.completedAt)),
      )
      .limit(1);
    expect(feed).toBeDefined();

    await clockIn(jorgeId, new Date("2026-08-15T09:00:00Z"));
    await startActivity(jorgeId, "bank_feeds", harborlineId, new Date("2026-08-15T09:05:00Z"));
    expect((await getClockStatus(jorgeId, new Date("2026-08-15T09:10:00Z"))).currentActivity).not.toBeNull();

    await setBankFeedCompleted(feed.id, true, jorgeId);

    const status = await getClockStatus(jorgeId, new Date("2026-08-15T09:30:00Z"));
    expect(status.currentActivity).toBeNull();
    const [entry] = await db
      .select()
      .from(workstationTimeEntries)
      .where(
        and(
          eq(workstationTimeEntries.userId, jorgeId),
          eq(workstationTimeEntries.activityType, "bank_feeds"),
        ),
      )
      .limit(1);
    expect(entry.endedAt).not.toBeNull();
    expect(entry.durationMinutes).toBeGreaterThan(0);

    // The day umbrella stays open - only the card's activity timer stopped.
    expect(status.clockedIn).toBe(true);
  });
});
