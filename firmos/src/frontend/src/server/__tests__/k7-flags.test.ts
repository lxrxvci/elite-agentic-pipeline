import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { clients, notifications, tasks, taskTimeEntries, users } from "@/db/schema";
import { listFlaggedItems, reviewWeekStart } from "@/server/flags";
import { overdueCheckJob } from "@/server/jobs";
import { seedDatabase } from "@/server/seed";

import { dbReachable, TEST_TODAY } from "./helpers";

/**
 * K7 (G1/G2 + J7, 09_30 01:19:30-01:23:26): passive anomaly flags for the
 * weekly review - never notifications - and focus mode silences alerts.
 */

const reachable = await dbReachable();

describe.skipIf(!reachable)("passive flags + focus-mode suppression", () => {
  let clientId: number;
  let sofiaId: number;

  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    clientId = (await db.select().from(clients).where(eq(clients.legalName, "Harborline Marine Supply")).limit(1))[0].id;
    sofiaId = (await db.select().from(users).where(eq(users.email, "sofia@blueledgerbooks.com")).limit(1))[0].id;
  });

  it("long_open_task_flags_passively: overdue-unparked and over-time tasks flag; nothing notifies", async () => {
    // A stale open task (never deferred) flags.
    const [stale] = await db
      .insert(tasks)
      .values({
        clientId,
        title: "Reconcile July",
        status: "open",
        dueDate: "2026-08-01",
        attributedYear: 2026,
        attributedMonth: 8,
        assigneeId: sofiaId,
      })
      .returning();
    // A waiting-on-client task does NOT flag (parked on purpose).
    await db.insert(tasks).values({
      clientId,
      title: "Waiting on the client",
      status: "waiting_on_client",
      dueDate: "2026-08-01",
      attributedYear: 2026,
      attributedMonth: 8,
      assigneeId: sofiaId,
    });
    // Over-time: 3 hours logged and still open.
    const [long] = await db
      .insert(tasks)
      .values({ clientId, title: "Cleanup deep-dive", status: "in_progress", dueDate: "2026-08-20", assigneeId: sofiaId })
      .returning();
    await db.insert(taskTimeEntries).values({
      taskId: long.id,
      userId: sofiaId,
      startedAt: new Date("2026-08-14T16:00:00Z"),
      endedAt: new Date("2026-08-14T19:10:00Z"),
    });

    const flags = await listFlaggedItems(TEST_TODAY);
    const byId = new Map(flags.map((f) => [f.taskId, f]));
    expect(byId.get(stale.id)?.reason).toBe("overdue_not_deferred");
    expect(byId.get(stale.id)?.assigneeName).toBe("Sofia Lindqvist");
    expect(byId.get(long.id)?.reason).toBe("over_time");
    expect(byId.get(long.id)?.detail).toContain("3.2 hours");
    expect(flags.some((f) => f.title === "Waiting on the client")).toBe(false);
  });

  it("the review-week anchor lands on Monday", () => {
    // 2026-08-15 is a Saturday.
    expect(reviewWeekStart(TEST_TODAY)).toBe("2026-08-10");
  });

  it("focus_mode_silences_alerts: a focused assignee gets no overdue notification", async () => {
    await db.update(users).set({ focusMode: true }).where(eq(users.id, sofiaId));
    try {
      await overdueCheckJob(new Date(`${TEST_TODAY.year}-0${TEST_TODAY.month}-${TEST_TODAY.day}T14:00:00Z`));
      const rows = await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.userId, sofiaId), eq(notifications.notificationType, "task_overdue")));
      expect(rows).toHaveLength(0);
    } finally {
      await db.update(users).set({ focusMode: false }).where(eq(users.id, sofiaId));
    }
  });
});
