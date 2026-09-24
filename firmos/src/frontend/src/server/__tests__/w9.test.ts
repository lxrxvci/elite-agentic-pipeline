import { and, asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { auditEvents, clients, correspondence, users, w9Recipients } from "@/db/schema";
import { w9ReminderJob } from "@/server/jobs";
import { seedDatabase } from "@/server/seed";
import {
  W9_REMINDER_CADENCE_DAYS,
  computeW9ReminderPlans,
  createW9Recipient,
  emailW9Request,
  markW9Received,
} from "@/server/w9";

import { TEST_TODAY, clientIdByName, dbReachable } from "./helpers";

/**
 * §18 + Phase 3C W-9 outreach: the request mail rides the correspondence
 * engine (branded template, history row, audit), and the weekly reminder job
 * chases pending recipients on a 7-day cadence until the W-9 is received.
 */
const reachable = await dbReachable();

const T0 = new Date("2026-08-10T16:00:00.000Z"); // noon firm-local

async function correspondenceFor(clientId: number) {
  return db
    .select()
    .from(correspondence)
    .where(and(eq(correspondence.clientId, clientId), eq(correspondence.template, "w9_request")))
    .orderBy(asc(correspondence.id));
}

describe.skipIf(!reachable)("w9 outreach (§18 + Phase 3C)", () => {
  let ownerId: number;
  let harborlineId: number;

  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    const [owner] = await db.select().from(users).where(eq(users.email, "mara@blueledgerbooks.com")).limit(1);
    ownerId = owner.id;
    harborlineId = clientIdByName(await db.select().from(clients), "Harborline Marine Supply");
  });

  it("emails the request through the correspondence engine and stamps the recipient", async () => {
    const recipient = await createW9Recipient(ownerId, {
      clientId: harborlineId,
      vendorName: "Cascade Print Co",
      year: 2026,
      email: "ap@cascadeprint.example",
      totalPaid: "2400",
    });

    const updated = await emailW9Request(recipient.id, "ap@cascadeprint.example", ownerId, T0);
    expect(updated.w9RequestedAt?.toISOString()).toBe(T0.toISOString());

    const rows = await correspondenceFor(harborlineId);
    expect(rows.length).toBe(1);
    expect(rows[0].toEmail).toBe("ap@cascadeprint.example");
    expect(rows[0].subject).toBe("W-9 request from Harborline Marine Supply (2026)");
    expect(rows[0].bodyText).toContain("Upload your W-9");
    expect(rows[0].status).toBe("sent");
    expect(rows[0].direction).toBe("outbound");

    const audit = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, "w9_request_emailed"), eq(auditEvents.entityId, recipient.id)));
    expect(audit.length).toBe(1);

    await expect(emailW9Request(recipient.id, "not-an-email", ownerId)).rejects.toMatchObject({
      status: 400,
    });
  });

  it("the reminder job chases weekly until received, cadence-deduped on w9_requested_at", async () => {
    const due = await createW9Recipient(ownerId, {
      clientId: harborlineId,
      vendorName: "Dusk IT Services",
      year: 2026,
      email: "bills@duskit.example",
      totalPaid: "900",
    });
    const noEmail = await createW9Recipient(ownerId, {
      clientId: harborlineId,
      vendorName: "No Email LLC",
      year: 2026,
      totalPaid: "700",
    });
    // Never requested: outreach starts with a human - the job must not make
    // first contact.
    const neverRequested = await createW9Recipient(ownerId, {
      clientId: harborlineId,
      vendorName: "Quiet Vendor",
      year: 2026,
      email: "quiet@example.com",
      totalPaid: "650",
    });

    // Initial request (staff action) at T0.
    await emailW9Request(due.id, "bills@duskit.example", ownerId, T0);

    // Within the cadence: nothing due.
    const inside = await computeW9ReminderPlans(new Date(T0.getTime() + 3 * 24 * 60 * 60_000));
    expect(inside.plans.map((p) => p.recipientId)).not.toContain(due.id);

    // A week later: the pending recipient is due; the never-requested one is
    // untouched; the email-less one reports no_email.
    const later = new Date(T0.getTime() + W9_REMINDER_CADENCE_DAYS * 24 * 60 * 60_000 + 60_000);
    // noEmail was never requested, so it is not even a candidate - mark it
    // requested in the past to exercise the no_email skip branch.
    await db
      .update(w9Recipients)
      .set({ w9RequestedAt: T0 })
      .where(eq(w9Recipients.id, noEmail.id));
    const plans = await computeW9ReminderPlans(later);
    // Cascade (test 1, requested at T0) and Dusk are both due; the
    // never-requested vendor is untouched; the email-less one is a skip.
    expect(plans.plans.map((p) => p.recipientId)).toContain(due.id);
    expect(plans.plans.map((p) => p.recipientId)).not.toContain(neverRequested.id);
    expect(plans.skipped).toContainEqual({ recipientId: noEmail.id, reason: "no_email" });

    const jobRun = await w9ReminderJob(later);
    expect(jobRun.remindersSent).toBe(2);
    expect(jobRun.failures).toEqual([]);
    expect(jobRun.skipped).toContainEqual({ recipientId: noEmail.id, reason: "no_email" });

    // The reminder re-stamps the cadence and lands in the history.
    const after = await db.select().from(w9Recipients).where(eq(w9Recipients.id, due.id)).limit(1);
    expect(after[0].w9RequestedAt?.toISOString()).toBe(later.toISOString());
    const history = await correspondenceFor(harborlineId);
    expect(history.filter((r) => r.toEmail === "bills@duskit.example").length).toBe(2);

    const remindedAudit = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, "w9_request_reminded"), eq(auditEvents.entityId, due.id)));
    expect(remindedAudit.length).toBe(1);

    // Cadence dedup: an immediate rerun sends nothing.
    const rerun = await w9ReminderJob(new Date(later.getTime() + 60_000));
    expect(rerun.remindersSent).toBe(0);

    // Received stops the chase for good.
    await markW9Received(due.id, ownerId);
    const afterReceipt = await computeW9ReminderPlans(
      new Date(later.getTime() + W9_REMINDER_CADENCE_DAYS * 24 * 60 * 60_000),
    );
    expect(afterReceipt.plans.map((p) => p.recipientId)).not.toContain(due.id);
  });
});
