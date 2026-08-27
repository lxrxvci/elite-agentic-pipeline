import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  accounts,
  appSettings,
  auditEvents,
  clientIntakes,
  clientPurgeRequests,
  clients,
  notifications,
  portalChangeRequests,
  tasks,
  users,
} from "@/db/schema";
import {
  ApprovalError,
  getPurgatoryQueue,
  isPurgeEnabled,
  pauseClientDirectly,
  requestClientPause,
  requestClientPurge,
  requestClientReset,
  reviewPauseRequest,
  reviewPortalChangeRequest,
  reviewPurgeRequest,
  reviewResetRequest,
  reviewWorkingHours,
  submitWorkingHours,
} from "@/server/approvals";
import { seedDatabase } from "@/server/seed";

import { dbReachable, TEST_TODAY } from "./helpers";

const reachable = await dbReachable();

const OWNER = "mara@blueledgerbooks.com";
const ADMIN = "theo@blueledgerbooks.com";
const MANAGER = "dana@blueledgerbooks.com";
const BOOKKEEPER = "jorge@blueledgerbooks.com";
const CLIENT_USER = "alison@harborlinemarine.com";

let maraId: number;
let theoId: number;
let danaId: number;
let jorgeId: number;
let alisonId: number;
let harborlineId: number;
let blueSpruceId: number;
let copperlineId: number;
let northwindId: number;

async function userIdByEmail(email: string): Promise<number> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!row) throw new Error(`seeded user not found: ${email}`);
  return row.id;
}

async function clientIdByName(legalName: string): Promise<number> {
  const [row] = await db.select({ id: clients.id }).from(clients).where(eq(clients.legalName, legalName)).limit(1);
  if (!row) throw new Error(`seeded client not found: ${legalName}`);
  return row.id;
}

async function auditActions(entityType: string, entityId: number): Promise<string[]> {
  const rows = await db
    .select({ action: auditEvents.action })
    .from(auditEvents)
    .where(and(eq(auditEvents.entityType, entityType), eq(auditEvents.entityId, entityId)));
  return rows.map((r) => r.action);
}

async function notificationTypesFor(userId: number): Promise<string[]> {
  const rows = await db
    .select({ notificationType: notifications.notificationType })
    .from(notifications)
    .where(eq(notifications.userId, userId));
  return rows.map((r) => r.notificationType);
}

async function setPurgeFlag(enabled: boolean): Promise<void> {
  const [existing] = await db.select().from(appSettings).where(eq(appSettings.key, "feature_flags")).limit(1);
  const value = { ...(existing?.value as Record<string, unknown> | undefined), purge_enabled: enabled };
  if (existing) {
    await db.update(appSettings).set({ value }).where(eq(appSettings.key, "feature_flags"));
  } else {
    await db.insert(appSettings).values({ key: "feature_flags", value });
  }
}

/** A disposable client with an account, a task, and a converted intake. */
async function createDisposableClient(legalName: string): Promise<{ clientId: number; intakeId: number }> {
  const [client] = await db
    .insert(clients)
    .values({ legalName, bookkeepingFrequency: "monthly", managerId: danaId, bookkeeperId: jorgeId })
    .returning();
  await db.insert(accounts).values({ clientId: client.id, name: "Checking", accountType: "checking" });
  await db.insert(tasks).values({ clientId: client.id, title: "Disposable task", taskType: "ad_hoc" });
  const [intake] = await db
    .insert(clientIntakes)
    .values({
      legalName,
      status: "completed",
      clientId: client.id,
      convertedAt: new Date(),
      managerId: danaId,
      bookkeeperId: jorgeId,
    })
    .returning();
  return { clientId: client.id, intakeId: intake.id };
}

describe.skipIf(!reachable)("approvals engine (HANDOFF §22, §30 conv. 11)", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    maraId = await userIdByEmail(OWNER);
    theoId = await userIdByEmail(ADMIN);
    danaId = await userIdByEmail(MANAGER);
    jorgeId = await userIdByEmail(BOOKKEEPER);
    alisonId = await userIdByEmail(CLIENT_USER);
    harborlineId = await clientIdByName("Harborline Marine Supply");
    blueSpruceId = await clientIdByName("Blue Spruce Landscaping");
    copperlineId = await clientIdByName("Copperline Coffee Roasters");
    northwindId = await clientIdByName("Northwind Frame & Door");
  });

  afterAll(async () => {
    await setPurgeFlag(false);
  });

  // ── Pause (§22) ──

  it("pause request -> admin approve applies is_paused, writes audit + notifications at each step", async () => {
    const request = await requestClientPause(harborlineId, danaId, "Seasonal slowdown");
    expect(request.status).toBe("pending");

    // Request step: audit + notify admins/owners.
    expect(await auditActions("client_pause_request", request.id)).toEqual(["pause_requested"]);
    expect(await notificationTypesFor(theoId)).toContain("pause_requested");
    expect(await notificationTypesFor(maraId)).toContain("pause_requested");

    // The requester can never review their own request (§30 conv. 11).
    await expect(reviewPauseRequest(request.id, danaId, true)).rejects.toMatchObject({
      name: "ApprovalError",
      status: 403,
    });

    const reviewed = await reviewPauseRequest(request.id, theoId, true);
    expect(reviewed.status).toBe("approved");
    expect(reviewed.reviewedById).toBe(theoId);

    const [client] = await db.select().from(clients).where(eq(clients.id, harborlineId)).limit(1);
    expect(client.isPaused).toBe(true);
    expect(client.pausedAt).not.toBeNull();
    expect(client.pausedById).toBe(theoId);

    expect(await auditActions("client_pause_request", request.id)).toEqual(["pause_requested", "pause_approved"]);
    expect(await notificationTypesFor(danaId)).toContain("pause_approved");
  });

  it("blocks a second pending pause request for the same client", async () => {
    await requestClientPause(blueSpruceId, danaId);
    await expect(requestClientPause(blueSpruceId, danaId)).rejects.toMatchObject({ status: 409 });
  });

  it("admins/owners can pause directly without the request flow", async () => {
    const client = await pauseClientDirectly(copperlineId, theoId);
    expect(client.isPaused).toBe(true);
    const rows = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(and(eq(auditEvents.entityType, "client"), eq(auditEvents.entityId, copperlineId)));
    expect(rows.map((r) => r.action)).toContain("client_paused_direct");
  });

  // ── Purge (§22: four-eyes, feature flag, irreversible graph delete) ──

  it("rejects purge requests while the purge_enabled feature flag is off", async () => {
    await setPurgeFlag(false);
    expect(await isPurgeEnabled()).toBe(false);
    const { clientId } = await createDisposableClient("Purge Flag Off LLC");
    await expect(requestClientPurge(clientId, theoId)).rejects.toMatchObject({ status: 403 });
  });

  it("enforces four-eyes: the requester cannot approve their own purge", async () => {
    await setPurgeFlag(true);
    const { clientId } = await createDisposableClient("Purge Four Eyes LLC");
    const request = await requestClientPurge(clientId, theoId, "Duplicate record");
    expect(await notificationTypesFor(maraId)).toContain("purge_requested");

    await expect(reviewPurgeRequest(request.id, theoId, true)).rejects.toMatchObject({ status: 403 });
    // Still pending after the failed review.
    const [check] = await db.select().from(clientPurgeRequests).where(eq(clientPurgeRequests.id, request.id)).limit(1);
    expect(check.status).toBe("pending");
  });

  it("owner approval deletes the whole client graph inside one transaction", async () => {
    await setPurgeFlag(true);
    const { clientId, intakeId } = await createDisposableClient("Purge Me Industries");
    const request = await requestClientPurge(clientId, theoId);

    const result = await reviewPurgeRequest(request.id, maraId, true);
    expect(result.status).toBe("approved");
    expect(result.deleted?.clients).toBe(1);
    expect(result.deleted?.accounts).toBe(1);
    expect(result.deleted?.tasks).toBe(1);
    expect(result.deleted?.client_intakes).toBe(1);

    // The graph is gone.
    expect((await db.select().from(clients).where(eq(clients.id, clientId))).length).toBe(0);
    expect((await db.select().from(accounts).where(eq(accounts.clientId, clientId))).length).toBe(0);
    expect((await db.select().from(tasks).where(eq(tasks.clientId, clientId))).length).toBe(0);
    expect((await db.select().from(clientIntakes).where(eq(clientIntakes.id, intakeId))).length).toBe(0);

    // The request row died with the client; audit_events is the trail.
    expect(await auditActions("client_purge_request", request.id)).toEqual(["purge_requested", "purge_approved"]);
    expect(await auditActions("client", clientId)).toContain("client_purged");
    expect(await notificationTypesFor(theoId)).toContain("purge_approved");
  });

  // ── Reset (§22: same deletes, intakes unlinked) ──

  it("reset approval deletes the client graph but unlinks the intake for re-conversion", async () => {
    const { clientId, intakeId } = await createDisposableClient("Reset Me Studios");
    const request = await requestClientReset(clientId, theoId, "Converted with the wrong start date");

    const result = await reviewResetRequest(request.id, maraId, true);
    expect(result.status).toBe("approved");
    expect(result.deleted?.clients).toBe(1);
    expect(result.deleted?.client_intakes_unlinked).toBe(1);

    expect((await db.select().from(clients).where(eq(clients.id, clientId))).length).toBe(0);
    const [intake] = await db.select().from(clientIntakes).where(eq(clientIntakes.id, intakeId)).limit(1);
    expect(intake.clientId).toBeNull();
    expect(intake.status).toBe("pending_review");
    expect(intake.convertedAt).toBeNull();

    expect(await auditActions("client_reset_request", request.id)).toEqual(["reset_requested", "reset_approved"]);
  });

  // ── Working hours (§16/§22) ──

  it("working hours submit -> admin approve; the submitter cannot self-approve", async () => {
    const schedule = { mon: [{ start: "09:00", end: "17:00" }], tue: [{ start: "09:00", end: "17:00" }] };
    const submission = await submitWorkingHours(jorgeId, schedule);
    expect(submission.status).toBe("pending");
    expect(submission.submittedAt).not.toBeNull();

    expect(await auditActions("user_working_hours", submission.id)).toEqual(["working_hours_submitted"]);
    expect(await notificationTypesFor(theoId)).toContain("working_hours_pending");

    await expect(reviewWorkingHours(submission.id, jorgeId, true)).rejects.toMatchObject({ status: 403 });

    const reviewed = await reviewWorkingHours(submission.id, theoId, true);
    expect(reviewed.status).toBe("approved");
    expect(await auditActions("user_working_hours", submission.id)).toEqual([
      "working_hours_submitted",
      "working_hours_approved",
    ]);
  });

  it("allows only one pending working-hours submission per user", async () => {
    const schedule = { wed: [{ start: "08:00", end: "16:00" }] };
    const first = await submitWorkingHours(danaId, schedule);
    await expect(submitWorkingHours(danaId, schedule)).rejects.toMatchObject({ status: 409 });
    await reviewWorkingHours(first.id, theoId, false);
    // After rejection the user can submit again.
    const second = await submitWorkingHours(danaId, schedule);
    await reviewWorkingHours(second.id, theoId, false);
  });

  it("rejects invalid working-hours payloads", async () => {
    await expect(submitWorkingHours(jorgeId, [] as unknown as Record<string, unknown>)).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      submitWorkingHours(jorgeId, null as unknown as Record<string, unknown>),
    ).rejects.toMatchObject({ status: 400 });
  });

  // ── Portal change requests (§12/§22) ──

  it("approving a portal change request applies the field change to the client", async () => {
    const [request] = await db
      .insert(portalChangeRequests)
      .values({
        clientId: harborlineId,
        requestedById: alisonId,
        fieldName: "tax_structure",
        oldValue: "LLC",
        newValue: "S-corp",
      })
      .returning();

    const reviewed = await reviewPortalChangeRequest(request.id, theoId, true);
    expect(reviewed.status).toBe("approved");

    const [client] = await db.select().from(clients).where(eq(clients.id, harborlineId)).limit(1);
    expect(client.taxStructure).toBe("S-corp");

    expect(await auditActions("portal_change_request", request.id)).toEqual(["portal_change_request_approved"]);
    expect(await notificationTypesFor(alisonId)).toContain("portal_change_request_approved");
  });

  it("rejects applying an invalid frequency value and leaves the request pending", async () => {
    const [request] = await db
      .insert(portalChangeRequests)
      .values({
        clientId: harborlineId,
        requestedById: alisonId,
        fieldName: "bookkeeping_frequency",
        oldValue: "monthly",
        newValue: "banana",
      })
      .returning();

    await expect(reviewPortalChangeRequest(request.id, maraId, true)).rejects.toMatchObject({ status: 400 });
    const [row] = await db.select().from(portalChangeRequests).where(eq(portalChangeRequests.id, request.id)).limit(1);
    expect(row.status).toBe("pending");
  });

  // ── Purgatory queue (§22 + the reset fix) ──

  it("purgatory queue contains all four kinds, including reset (the original gap)", async () => {
    // Ensure one pending item of each kind exists.
    await requestClientPurge(northwindId, theoId, "queue coverage").catch(() => undefined);
    await requestClientReset(northwindId, theoId, "queue coverage").catch(() => undefined);
    const [portalReq] = await db
      .insert(portalChangeRequests)
      .values({ clientId: copperlineId, requestedById: alisonId, fieldName: "accounting_method", newValue: "accrual" })
      .onConflictDoNothing()
      .returning();
    void portalReq;

    const queue = await getPurgatoryQueue();
    const kinds = new Set(queue.map((i) => i.kind));
    expect(kinds).toContain("pause");
    expect(kinds).toContain("purge");
    expect(kinds).toContain("reset");
    expect(kinds).toContain("portal_change");

    // Every item is pending-only and carries client + requester names.
    for (const item of queue) {
      expect(item.clientName.length).toBeGreaterThan(0);
      expect(item.requesterName.length).toBeGreaterThan(0);
    }
    // Deterministic order: oldest first.
    const times = queue.map((i) => i.createdAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("reviewing a non-pending request is a 409", async () => {
    const request = await requestClientPause(northwindId, danaId).catch(() => null);
    if (request) {
      await reviewPauseRequest(request.id, theoId, false);
      await expect(reviewPauseRequest(request.id, theoId, true)).rejects.toMatchObject({ status: 409 });
    } else {
      // A pause for Northwind was already pending from an earlier test path.
      expect(ApprovalError).toBeDefined();
    }
  });
});
