import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  auditEvents,
  tasks,
  taskTimeEntries,
  users,
  workstationTimeEditRequests,
  workstationTimeEntries,
} from "@/db/schema";
import { seedDatabase } from "@/server/seed";
import {
  reviewTimeEditRequest,
  submitTimeEditRequest,
  TimeEditError,
} from "@/server/time-edits";

import { TEST_TODAY, dbReachable } from "./helpers";

/**
 * Clock-C3 time-edit guards (original parity): future times rejected, the
 * 24-hour session cap, same-class overlap rejection at REQUEST and again at
 * APPROVAL, and one pending request per entry. Breaks legally span task
 * timers (Clock-C1), so a break edit never checks the task-timer class.
 */

const reachable = await dbReachable();

let seq = 0;
const fixtureUserIds: number[] = [];
const fixtureTaskIds: number[] = [];

async function makeUser(
  role: "owner" | "admin" | "manager" | "bookkeeper",
  extra: Partial<typeof users.$inferInsert> = {},
) {
  seq += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `guard-test-${seq}@firmos-test.local`,
      firstName: "Guard",
      lastName: `User${seq}`,
      passwordHash: "x",
      role,
      ...extra,
    })
    .returning();
  fixtureUserIds.push(u.id);
  return u;
}

async function makeEntry(
  userId: number,
  activityType: string,
  startedAt: Date,
  endedAt: Date | null,
  extra: Partial<typeof workstationTimeEntries.$inferInsert> = {},
) {
  const [entry] = await db
    .insert(workstationTimeEntries)
    .values({
      userId,
      activityType: activityType as typeof workstationTimeEntries.$inferInsert.activityType,
      startedAt,
      endedAt,
      durationMinutes:
        endedAt != null ? Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000) : null,
      ...extra,
    })
    .returning();
  return entry;
}

async function makeTaskTimer(userId: number, startedAt: Date, endedAt: Date | null) {
  const [task] = await db.insert(tasks).values({ title: `Guard task ${seq}` }).returning();
  fixtureTaskIds.push(task.id);
  const [entry] = await db
    .insert(taskTimeEntries)
    .values({
      taskId: task.id,
      userId,
      startedAt,
      endedAt,
      durationMinutes:
        endedAt != null ? Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000) : null,
    })
    .returning();
  return entry;
}

async function seededAdminId(): Promise<number> {
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, "theo@blueledgerbooks.com"))
    .limit(1);
  return admin.id;
}

async function requestStatus(requestId: number): Promise<string> {
  const [row] = await db
    .select({ status: workstationTimeEditRequests.status })
    .from(workstationTimeEditRequests)
    .where(eq(workstationTimeEditRequests.id, requestId))
    .limit(1);
  return row.status;
}

/** August 2026, process-local (firm-local for the tests). */
const d = (day: number, h: number, m = 0) => new Date(2026, 7, day, h, m, 0, 0);
/** Pinned "now" for the guard checks: Aug 20 2026, noon. */
const NOW = d(20, 12);

describe.skipIf(!reachable)("time edit guards (Clock-C3)", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
  });

  afterAll(async () => {
    await db
      .delete(auditEvents)
      .where(eq(auditEvents.entityType, "workstation_time_edit_request"));
    await db
      .delete(taskTimeEntries)
      .where(inArray(taskTimeEntries.userId, fixtureUserIds));
    if (fixtureTaskIds.length > 0) {
      await db.delete(tasks).where(inArray(tasks.id, fixtureTaskIds));
    }
    await db.delete(users).where(inArray(users.id, fixtureUserIds));
  });

  it("rejects corrected times in the future (start and end, +1 minute); exactly-now passes", async () => {
    const u = await makeUser("bookkeeper");
    const entry = await makeEntry(u.id, "day", d(10, 9), d(10, 17));

    await expect(
      submitTimeEditRequest(u.id, entry.id, new Date(NOW.getTime() + 60_000), new Date(NOW.getTime() + 3_600_000), undefined, NOW),
    ).rejects.toMatchObject({ status: 400, message: "Corrected start cannot be in the future" });

    await expect(
      submitTimeEditRequest(u.id, entry.id, new Date(NOW.getTime() - 3_600_000), new Date(NOW.getTime() + 60_000), undefined, NOW),
    ).rejects.toMatchObject({ status: 400, message: "Corrected end cannot be in the future" });

    // Boundary: ending exactly at now is not the future.
    const ok = await submitTimeEditRequest(
      u.id,
      entry.id,
      new Date(NOW.getTime() - 3_600_000),
      NOW,
      undefined,
      NOW,
    );
    expect(ok.status).toBe("pending");
  });

  it("enforces the 24-hour cap: exactly 24h passes, 24h + 1 minute rejected", async () => {
    const u = await makeUser("bookkeeper");
    const entry = await makeEntry(u.id, "day", d(10, 9), d(10, 17));

    const exact = await submitTimeEditRequest(u.id, entry.id, d(10, 9), d(11, 9), undefined, NOW);
    expect(exact.status).toBe("pending");
    await reviewTimeEditRequest(exact.id, await seededAdminId(), false, NOW);

    await expect(
      submitTimeEditRequest(u.id, entry.id, d(10, 9), d(11, 9, 1), undefined, NOW),
    ).rejects.toMatchObject({
      status: 400,
      message: "A time entry cannot span more than 24 hours",
    });

    // An open-ended correction carries no duration yet: the cap cannot fire.
    const open = await submitTimeEditRequest(u.id, entry.id, d(10, 9), null, undefined, NOW);
    expect(open.status).toBe("pending");
  });

  it("rejects same-class overlap at REQUEST, both directions; adjacent spans pass", async () => {
    const u = await makeUser("bookkeeper");
    await makeEntry(u.id, "bank_feeds", d(10, 9), d(10, 12)); // the sibling
    const edited = await makeEntry(u.id, "reconciliations", d(10, 13), d(10, 17));

    // Edited span starts before the sibling and ends inside it.
    await expect(
      submitTimeEditRequest(u.id, edited.id, d(10, 8), d(10, 10), undefined, NOW),
    ).rejects.toMatchObject({ status: 409, message: "These times overlap another recorded entry" });
    // Edited span starts inside the sibling and ends after it.
    await expect(
      submitTimeEditRequest(u.id, edited.id, d(10, 11), d(10, 18), undefined, NOW),
    ).rejects.toMatchObject({ status: 409, message: "These times overlap another recorded entry" });
    // Full containment.
    await expect(
      submitTimeEditRequest(u.id, edited.id, d(10, 8), d(10, 18), undefined, NOW),
    ).rejects.toMatchObject({ status: 409 });

    // Adjacent (touching, not overlapping) and disjoint spans pass.
    const adjacent = await submitTimeEditRequest(u.id, edited.id, d(10, 12), d(10, 13), undefined, NOW);
    expect(adjacent.status).toBe("pending");
    await reviewTimeEditRequest(adjacent.id, await seededAdminId(), false, NOW);
    const disjoint = await submitTimeEditRequest(u.id, edited.id, d(11, 9), d(11, 10), undefined, NOW);
    expect(disjoint.status).toBe("pending");
  });

  it("class rules: the day umbrella never blocks an activity; day-day overlap rejected; breaks may span task timers, work activities may not", async () => {
    const u = await makeUser("bookkeeper");
    const day = await makeEntry(u.id, "day", d(10, 9), d(10, 17));
    const activity = await makeEntry(u.id, "bank_feeds", d(10, 9, 30), d(10, 11));

    // Activity edits stay inside the umbrella: the day is another class.
    const inside = await submitTimeEditRequest(u.id, activity.id, d(10, 10), d(10, 12), undefined, NOW);
    expect(inside.status).toBe("pending");
    await reviewTimeEditRequest(inside.id, await seededAdminId(), false, NOW);

    // Two day umbrellas may not overlap (exactly 24h, so only overlap can fire).
    await makeEntry(u.id, "day", d(11, 9), d(11, 17));
    await expect(
      submitTimeEditRequest(u.id, day.id, d(10, 12), d(11, 12), undefined, NOW),
    ).rejects.toMatchObject({ status: 409, message: "These times overlap another recorded entry" });

    // A break edit overlapping a task timer is legal (Clock-C1: breaks span).
    const breakEntry = await makeEntry(u.id, "break_unpaid", d(12, 12), d(12, 12, 30));
    await makeTaskTimer(u.id, d(12, 12, 15), d(12, 13));
    const breakEdit = await submitTimeEditRequest(u.id, breakEntry.id, d(12, 12), d(12, 13), undefined, NOW);
    expect(breakEdit.status).toBe("pending");
    await reviewTimeEditRequest(breakEdit.id, await seededAdminId(), false, NOW);

    // A WORK activity overlapping the same task timer is double attribution.
    const work = await makeEntry(u.id, "bank_feeds", d(12, 15), d(12, 16));
    await expect(
      submitTimeEditRequest(u.id, work.id, d(12, 12, 30), d(12, 14), undefined, NOW),
    ).rejects.toMatchObject({
      status: 409,
      message: "These times overlap a running or recorded task timer",
    });
  });

  it("re-checks overlap at APPROVAL (entries recorded since the request), and the request stays pending on failure", async () => {
    const u = await makeUser("bookkeeper");
    const adminId = await seededAdminId();
    const edited = await makeEntry(u.id, "reconciliations", d(10, 9), d(10, 10));

    const request = await submitTimeEditRequest(u.id, edited.id, d(10, 11), d(10, 12), undefined, NOW);
    expect(request.status).toBe("pending");

    // The world changes while the request sits pending: a sibling lands on
    // the corrected span (tail overlap), then one on its head.
    const sibling = await makeEntry(u.id, "bank_feeds", d(10, 11, 30), d(10, 13));
    await expect(reviewTimeEditRequest(request.id, adminId, true, NOW)).rejects.toMatchObject({
      status: 409,
      message: "These times overlap another recorded entry",
    });
    expect(await requestStatus(request.id)).toBe("pending");

    await db
      .update(workstationTimeEntries)
      .set({ startedAt: d(10, 10, 15), endedAt: d(10, 11, 45) })
      .where(eq(workstationTimeEntries.id, sibling.id));
    await expect(reviewTimeEditRequest(request.id, adminId, true, NOW)).rejects.toMatchObject({
      status: 409,
    });
    expect(await requestStatus(request.id)).toBe("pending");

    // Move the sibling clear and the same request approves cleanly.
    await db
      .update(workstationTimeEntries)
      .set({ startedAt: d(10, 14), endedAt: d(10, 15) })
      .where(eq(workstationTimeEntries.id, sibling.id));
    const reviewed = await reviewTimeEditRequest(request.id, adminId, true, NOW);
    expect(reviewed.status).toBe("approved");
    const [after] = await db
      .select()
      .from(workstationTimeEntries)
      .where(eq(workstationTimeEntries.id, edited.id));
    expect(after.startedAt).toEqual(d(10, 11));
    expect(after.durationMinutes).toBe(60);
  });

  it("re-checks the future guard at APPROVAL", async () => {
    const u = await makeUser("bookkeeper");
    const adminId = await seededAdminId();
    const edited = await makeEntry(u.id, "day", d(10, 9), d(10, 17));
    const request = await submitTimeEditRequest(u.id, edited.id, d(11, 9), d(11, 17), undefined, NOW);
    // Review "as of" before the requested start - the span is in the future.
    await expect(
      reviewTimeEditRequest(request.id, adminId, true, d(10, 12)),
    ).rejects.toMatchObject({ status: 400, message: "Corrected start cannot be in the future" });
    expect(await requestStatus(request.id)).toBe("pending");
  });

  it("one pending request per entry, with the friendly message; a fresh request is allowed after review", async () => {
    const u = await makeUser("bookkeeper");
    const adminId = await seededAdminId();
    const entry = await makeEntry(u.id, "day", d(10, 9), d(10, 17));

    const first = await submitTimeEditRequest(u.id, entry.id, d(10, 8, 30), d(10, 16, 45), undefined, NOW);
    expect(first.status).toBe("pending");

    await expect(
      submitTimeEditRequest(u.id, entry.id, d(10, 8), d(10, 16), undefined, NOW),
    ).rejects.toMatchObject({
      name: "TimeEditError",
      status: 409,
      message: "This entry already has a pending request",
    });

    await reviewTimeEditRequest(first.id, adminId, false, NOW);
    const second = await submitTimeEditRequest(u.id, entry.id, d(10, 8), d(10, 16), undefined, NOW);
    expect(second.status).toBe("pending");
  });
});
