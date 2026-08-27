import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { auditEvents, tasks, users } from "@/db/schema";
import { assertRole, AuthError, toSessionUser } from "@/server/auth/guards";
import { seedDatabase } from "@/server/seed";
import {
  listTrashedTasks,
  purgeTrashedTask,
  restoreTrashedTask,
  TRASH_RETENTION_DAYS,
  TrashError,
} from "@/server/trash";

import { TEST_TODAY, dbReachable } from "./helpers";

const reachable = await dbReachable();

/**
 * Trash bin (HANDOFF §9): restore clears deleted_at, purge hard-deletes,
 * both audit-logged; the role gate (admin/owner) is asserted on the guard
 * the actions use.
 */
describe.skipIf(!reachable)("trash engine", () => {
  let theo: number;
  let probeTaskId: number;

  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    const [row] = await db.select().from(users).where(eq(users.email, "theo@blueledgerbooks.com"));
    theo = row.id;
    const [probe] = await db
      .insert(tasks)
      .values({ title: "Trash probe task", taskType: "ad_hoc", status: "new" })
      .returning({ id: tasks.id });
    probeTaskId = probe.id;
  });

  afterAll(async () => {
    // The probe task may already be purged; delete is idempotent.
    await db.delete(tasks).where(eq(tasks.id, probeTaskId));
    await db
      .delete(auditEvents)
      .where(and(eq(auditEvents.entityType, "task"), eq(auditEvents.entityId, probeTaskId)));
  });

  it("lists only soft-deleted tasks with the retention countdown", async () => {
    const deletedAt = new Date("2026-08-10T12:00:00Z");
    await db.update(tasks).set({ deletedAt }).where(eq(tasks.id, probeTaskId));

    const items = await listTrashedTasks(new Date("2026-08-15T12:00:00Z"));
    const probe = items.find((i) => i.id === probeTaskId);
    expect(probe).toBeDefined();
    expect(probe?.title).toBe("Trash probe task");
    expect(probe?.purgeInDays).toBe(TRASH_RETENTION_DAYS - 5);

    // Live tasks never appear.
    expect(items.some((i) => i.title !== "Trash probe task")).toBe(false);
  });

  it("restore clears deleted_at and writes the audit event", async () => {
    await restoreTrashedTask(probeTaskId, theo);

    const [row] = await db.select().from(tasks).where(eq(tasks.id, probeTaskId));
    expect(row.deletedAt).toBeNull();

    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, probeTaskId));
    expect(events.some((e) => e.action === "task.restore" && e.userId === theo)).toBe(true);
  });

  it("restore refuses live tasks and unknown ids", async () => {
    await expect(restoreTrashedTask(probeTaskId, theo)).rejects.toThrow(TrashError);
    await expect(restoreTrashedTask(999_999, theo)).rejects.toThrow(/not in the trash/i);
  });

  it("purge hard-deletes the row and leaves the audit trail", async () => {
    await db.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, probeTaskId));
    await purgeTrashedTask(probeTaskId, theo);

    const [row] = await db.select().from(tasks).where(eq(tasks.id, probeTaskId));
    expect(row).toBeUndefined();

    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, probeTaskId));
    expect(events.some((e) => e.action === "task.purge" && e.userId === theo)).toBe(true);
  });

  it("the actions-layer role gate admits admin/owner and rejects staff", async () => {
    const adminRow = toSessionUser(
      (await db.select().from(users).where(eq(users.email, "theo@blueledgerbooks.com")))[0],
    );
    const managerRow = toSessionUser(
      (await db.select().from(users).where(eq(users.email, "dana@blueledgerbooks.com")))[0],
    );
    const clientRow = toSessionUser(
      (await db.select().from(users).where(eq(users.email, "alison@harborlinemarine.com")))[0],
    );

    expect(() => assertRole(adminRow, "admin", "owner")).not.toThrow();
    expect(() => assertRole(managerRow, "admin", "owner")).toThrow(AuthError);
    expect(() => assertRole(clientRow, "admin", "owner")).toThrow(AuthError);
  });
});
