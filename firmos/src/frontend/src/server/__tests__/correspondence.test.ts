import { createHmac } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import {
  accounts,
  auditEvents,
  clientIntakes,
  clients,
  contactClientLinks,
  contacts,
  correspondence,
  notifications,
  taskNotes,
  tasks,
  users,
} from "@/db/schema";
import { toSessionUser, type SessionUser } from "@/server/auth/guards";
import { convertIntakeToClient } from "@/server/convert";
import {
  computeMissingInfoReminders,
  getUnreadInboundByClient,
  ingestInboundEmail,
  listPortalCorrespondence,
  markPortalCorrespondenceRead,
  markStaffCorrespondenceRead,
  parseFromAddress,
  sendComposerEmail,
  sendQuoteReadyEmail,
  sendWelcomeEmail,
  THREAD_TOKEN_RE,
} from "@/server/correspondence";
import { __clearEmailStashForTests, getLastEmailFor } from "@/server/email";
import { parseResendInboundPayload, verifySvixSignature } from "@/server/email-inbound";
import { createIntake, markIntakeAccepted, submitIntakeForReview, updateIntake } from "@/server/intake";
import { missingInfoReminderJob } from "@/server/jobs";
import { PortalDisabledError } from "@/server/portal";
import { seedDatabase } from "@/server/seed";

import { dbReachable, TEST_TODAY } from "./helpers";

const reachable = await dbReachable();

const OWNER_EMAIL = "mara@blueledgerbooks.com";
const ADMIN_EMAIL = "theo@blueledgerbooks.com";
const MANAGER_EMAIL = "dana@blueledgerbooks.com";
const BOOKKEEPER_EMAIL = "jorge@blueledgerbooks.com";
const CLIENT_EMAIL = "alison@harborlinemarine.com";

let alison: SessionUser;
let harborlineId: number;
let alisonContactId: number;
let jorgeId: number;
let danaId: number;
let maraId: number;
let theoId: number;
let harborlineTaskId: number;

async function userIdByEmail(email: string): Promise<number> {
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!row) throw new Error(`seeded user not found: ${email}`);
  return row.id;
}

async function sessionUserByEmail(email: string): Promise<SessionUser> {
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!row) throw new Error(`seeded user not found: ${email}`);
  return toSessionUser(row);
}

async function clientIdByName(legalName: string): Promise<number> {
  const [row] = await db.select().from(clients).where(eq(clients.legalName, legalName)).limit(1);
  if (!row) throw new Error(`seeded client not found: ${legalName}`);
  return row.id;
}

describe.skipIf(!reachable)("correspondence hub", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    savedEnv.FIRMOS_PORTAL_ENABLED = process.env.FIRMOS_PORTAL_ENABLED;
    process.env.FIRMOS_PORTAL_ENABLED = "1";
    __clearEmailStashForTests();
    await seedDatabase(TEST_TODAY);

    alison = await sessionUserByEmail(CLIENT_EMAIL);
    harborlineId = await clientIdByName("Harborline Marine Supply");
    jorgeId = await userIdByEmail(BOOKKEEPER_EMAIL);
    danaId = await userIdByEmail(MANAGER_EMAIL);
    maraId = await userIdByEmail(OWNER_EMAIL);
    theoId = await userIdByEmail(ADMIN_EMAIL);
    const [link] = await db
      .select({ contactId: contactClientLinks.contactId })
      .from(contactClientLinks)
      .where(
        and(
          eq(contactClientLinks.clientId, harborlineId),
          eq(contactClientLinks.relationshipType, "owner"),
        ),
      )
      .limit(1);
    alisonContactId = link.contactId;
    // Any open Harborline task is a valid thread target for the composer.
    const [task] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.clientId, harborlineId))
      .limit(1);
    harborlineTaskId = task.id;
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // ── Write-on-send (the composer) ──

  it("writes a correspondence row on every send (dev driver), sender side pre-read", async () => {
    const row = await sendComposerEmail({
      clientId: harborlineId,
      contactId: alisonContactId,
      subject: "Quick hello",
      bodyText: "Checking in on your books.",
      sentById: danaId,
    });
    expect(row.direction).toBe("outbound");
    expect(row.channel).toBe("email");
    expect(row.status).toBe("sent");
    expect(row.template).toBe("staff_composer");
    expect(row.resendMessageId).toMatch(/^dev-/);
    // The writer's side is read at write time; the client side starts unread.
    expect(row.staffReadAt).not.toBeNull();
    expect(row.portalReadAt).toBeNull();

    const stashed = getLastEmailFor(CLIENT_EMAIL);
    expect(stashed?.subject).toBe("Quick hello");
    expect(stashed?.html).toContain("Checking in on your books.");

    const [audit] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, "correspondence_email_sent"), eq(auditEvents.entityId, row.id)))
      .limit(1);
    expect(audit).toBeDefined();
  });

  it("task-linked mail gets the waiting template and the [firmOS #t-N] thread token", async () => {
    const row = await sendComposerEmail({
      clientId: harborlineId,
      contactId: alisonContactId,
      subject: "Bank feed question",
      bodyText: "Which card was the Delta charge on?",
      taskId: harborlineTaskId,
      sentById: jorgeId,
    });
    expect(row.template).toBe("waiting_on_client");
    expect(row.taskId).toBe(harborlineTaskId);
    expect(row.subject).toContain(`[firmOS #t-${harborlineTaskId}]`);
    expect(row.bodyText).toContain("Just reply to this email");
    expect(getLastEmailFor(CLIENT_EMAIL)?.subject).toContain(`[firmOS #t-${harborlineTaskId}]`);
  });

  it("rejects a contact that is not linked to the client", async () => {
    const [otherContact] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.email, "carlos@riverstonetax.com"))
      .limit(1);
    await expect(
      sendComposerEmail({
        clientId: harborlineId,
        contactId: otherContact.id,
        subject: "Hi",
        bodyText: "body",
        sentById: danaId,
      }),
    ).rejects.toThrow(/not linked/);
  });

  // ── (a) welcome email ──

  it("sends the welcome mail when the portal is on and a contact has email", async () => {
    const result = await sendWelcomeEmail(harborlineId, danaId);
    expect(result.sent).toBe(true);
    const [row] = await db
      .select()
      .from(correspondence)
      .where(
        and(eq(correspondence.clientId, harborlineId), eq(correspondence.template, "welcome")),
      )
      .orderBy(desc(correspondence.id))
      .limit(1);
    expect(row.toEmail).toBe(CLIENT_EMAIL);
    expect(row.status).toBe("sent");
    expect(row.bodyText).toContain("portal");
  });

  it("respects the portal kill switch: disabled portal means no welcome mail", async () => {
    delete process.env.FIRMOS_PORTAL_ENABLED;
    try {
      const result = await sendWelcomeEmail(harborlineId, danaId);
      expect(result).toEqual({ sent: false, reason: "portal_disabled" });
    } finally {
      process.env.FIRMOS_PORTAL_ENABLED = "1";
    }
  });

  // ── (c) quote email (intake stage) ──

  it("sends the quote mail for an intake, linked by intake_id with client_id null", async () => {
    const [intake] = await db
      .select()
      .from(clientIntakes)
      .where(eq(clientIntakes.legalName, "Fern & Feather Floral Studio"))
      .limit(1);
    const row = await sendQuoteReadyEmail(intake.id, danaId);
    expect(row.template).toBe("quote_ready");
    expect(row.intakeId).toBe(intake.id);
    expect(row.clientId).toBeNull();
    expect(row.toEmail).toBe("wren@fernfeather.shop");
    expect(getLastEmailFor("wren@fernfeather.shop")?.subject).toContain("proposal");
  });

  // ── Conversion hook: backfill + auto welcome ──

  it("conversion backfills intake correspondence and auto-sends the welcome mail", async () => {
    const intake = await createIntake({
      legalName: "Correspondence Conversion Co",
      bookkeepingFrequency: "monthly",
      monthlyCloseTier: "15",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        contacts: [
          { firstName: "Pat", lastName: "Doe", email: "pat@correspondence-conversion.example", isPrimary: true },
        ],
      },
    });
    await updateIntake(intake.id, {});
    await submitIntakeForReview(intake.id);

    const quoteRow = await sendQuoteReadyEmail(intake.id, danaId);
    expect(quoteRow.clientId).toBeNull();

    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(intake.id);
    const result = await convertIntakeToClient(intake.id, {}, danaId, TEST_TODAY);
    expect(result.welcomeEmailSent).toBe(true);

    const rows = await db
      .select()
      .from(correspondence)
      .where(eq(correspondence.clientId, result.clientId))
      .orderBy(correspondence.id);
    // The quote mail joined the client's history, and the welcome mail followed.
    expect(rows.map((r) => r.template)).toEqual(["quote_ready", "welcome"]);
    expect(getLastEmailFor("pat@correspondence-conversion.example")?.subject).toContain("Welcome");
  });

  // ── (b)+(3) missing-info reminder job ──

  it("reminder job sends for missing info, dedupes on the 3-day cadence, and audit-logs", async () => {
    const now = new Date();
    // Age Harborline past the portal-activation grace period and give it one
    // unconfirmed account (no statement day, not manual-download).
    await db
      .update(clients)
      .set({ createdAt: new Date(now.getTime() - 10 * 24 * 60 * 60_000) })
      .where(eq(clients.id, harborlineId));
    const [acct] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.clientId, harborlineId))
      .limit(1);
    await db
      .update(accounts)
      .set({ statementDay: null, requiresManualTransactions: false })
      .where(eq(accounts.id, acct.id));

    const { plans } = await computeMissingInfoReminders(now);
    const harborline = plans.find((p) => p.clientId === harborlineId);
    expect(harborline).toBeDefined();
    expect(harborline!.reasons.some((r) => r.includes("portal login"))).toBe(true);
    expect(harborline!.reasons.some((r) => r.includes("statement"))).toBe(true);

    const first = await missingInfoReminderJob(now);
    expect(first.remindersSent).toBeGreaterThanOrEqual(1);
    const [reminderRow] = await db
      .select()
      .from(correspondence)
      .where(
        and(
          eq(correspondence.clientId, harborlineId),
          eq(correspondence.template, "missing_info_reminder"),
        ),
      )
      .orderBy(desc(correspondence.id))
      .limit(1);
    expect(reminderRow.status).toBe("sent");
    const [audit] = await db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.action, "correspondence_email_sent"), eq(auditEvents.entityId, reminderRow.id)),
      )
      .limit(1);
    expect(audit).toBeDefined();

    // Same-day rerun: the cadence dedup skips Harborline.
    const second = await missingInfoReminderJob(now);
    expect(second.skipped.some((s) => s.clientId === harborlineId && s.reason === "cadence")).toBe(true);
    const countAfterSecond = await db
      .select({ id: correspondence.id })
      .from(correspondence)
      .where(
        and(
          eq(correspondence.clientId, harborlineId),
          eq(correspondence.template, "missing_info_reminder"),
        ),
      );
    expect(countAfterSecond).toHaveLength(1);

    // Four days later the cadence window has passed: it sends again.
    const third = await missingInfoReminderJob(new Date(now.getTime() + 4 * 24 * 60 * 60_000));
    expect(third.remindersSent).toBeGreaterThanOrEqual(1);
    const countAfterThird = await db
      .select({ id: correspondence.id })
      .from(correspondence)
      .where(
        and(
          eq(correspondence.clientId, harborlineId),
          eq(correspondence.template, "missing_info_reminder"),
        ),
      );
    expect(countAfterThird).toHaveLength(2);
  });

  // ── (4) inbound ingest: thread token, references, sender fallback, triage ──

  it("threads a reply by the subject token onto the task: note + notifications + unread badge", async () => {
    const before = await db
      .select({ id: taskNotes.id })
      .from(taskNotes)
      .where(eq(taskNotes.taskId, harborlineTaskId));

    const result = await ingestInboundEmail({
      from: "Alison Brewer <alison@harborlinemarine.com>",
      subject: `Re: Bank feed question [firmOS #t-${harborlineTaskId}]`,
      text: "It was the Amex ending 1002.",
      messageId: "reply-1@harborlinemarine.com",
    });
    expect(result.matched).toBe("thread");
    expect(result.clientId).toBe(harborlineId);
    expect(result.taskId).toBe(harborlineTaskId);

    const notes = await db
      .select()
      .from(taskNotes)
      .where(eq(taskNotes.taskId, harborlineTaskId));
    expect(notes.length).toBe(before.length + 1);
    const note = notes.find((n) => n.authorId == null);
    expect(note?.body).toContain("Amex ending 1002");

    const replyNotices = await db
      .select()
      .from(notifications)
      .where(eq(notifications.notificationType, "client_reply"));
    const recipients = new Set(replyNotices.map((n) => n.userId));
    expect(recipients.has(jorgeId)).toBe(true);
    expect(recipients.has(danaId)).toBe(true);

    const unread = await getUnreadInboundByClient();
    expect(unread.get(harborlineId)).toBeGreaterThanOrEqual(1);

    const [row] = await db
      .select()
      .from(correspondence)
      .where(eq(correspondence.id, result.correspondenceId));
    expect(row.direction).toBe("inbound");
    expect(row.status).toBe("received");
    expect(row.staffReadAt).toBeNull();
    expect(row.portalReadAt).not.toBeNull(); // the client wrote it
  });

  it("threads a reply by In-Reply-To against the stored message id (no token)", async () => {
    const outbound = await sendComposerEmail({
      clientId: harborlineId,
      contactId: alisonContactId,
      subject: "Reconcile question",
      bodyText: "What is the opening balance?",
      taskId: harborlineTaskId,
      sentById: jorgeId,
    });
    const result = await ingestInboundEmail({
      from: CLIENT_EMAIL,
      subject: "Re: Reconcile question", // no token
      text: "Opening balance was 4,210.55.",
      messageId: "reply-2@harborlinemarine.com",
      inReplyTo: `<${outbound.resendMessageId}>`,
    });
    expect(result.matched).toBe("thread");
    expect(result.taskId).toBe(harborlineTaskId);
  });

  it("falls back to sender matching: correspondence on the client without a task", async () => {
    const result = await ingestInboundEmail({
      from: CLIENT_EMAIL,
      subject: "Quick question",
      text: "Can we move our call to Thursday?",
      messageId: "reply-3@harborlinemarine.com",
    });
    expect(result.matched).toBe("sender");
    expect(result.clientId).toBe(harborlineId);
    expect(result.taskId).toBeNull();
  });

  it("unmatched replies land client-less and triage-notify every active admin/owner", async () => {
    const result = await ingestInboundEmail({
      from: "Stranger <nobody@nowhere.example>",
      subject: "Hello?",
      text: "Wrong inbox, probably.",
      messageId: "reply-4@nowhere.example",
    });
    expect(result.matched).toBe("none");
    expect(result.clientId).toBeNull();

    const triage = await db
      .select()
      .from(notifications)
      .where(eq(notifications.notificationType, "correspondence_triage"));
    const recipients = new Set(triage.map((n) => n.userId));
    expect(recipients.has(maraId)).toBe(true);
    expect(recipients.has(theoId)).toBe(true);
  });

  // ── Badge read + staff read-marking ──

  it("staff read-marking clears the unread badge count", async () => {
    const before = await getUnreadInboundByClient();
    expect(before.get(harborlineId) ?? 0).toBeGreaterThanOrEqual(3);

    const marked = await markStaffCorrespondenceRead(harborlineId);
    expect(marked).toBeGreaterThanOrEqual(3);

    const after = await getUnreadInboundByClient();
    expect(after.get(harborlineId) ?? 0).toBe(0);
  });

  // ── Portal side: visibility, read-marking, kill switch ──

  it("portal lists only portal-visible rows and reading marks them read", async () => {
    // A staff-internal row never crosses into the portal.
    await db.insert(correspondence).values({
      clientId: harborlineId,
      direction: "outbound",
      channel: "email",
      subject: "Internal-only",
      bodyText: "staff eyes only",
      template: "staff_composer",
      status: "sent",
      portalVisible: false,
      staffReadAt: new Date(),
    });

    const first = await listPortalCorrespondence(alison, harborlineId);
    expect(first.rows.length).toBeGreaterThan(0);
    expect(first.rows.every((r) => r.portalVisible)).toBe(true);
    expect(first.rows.some((r) => r.subject === "Internal-only")).toBe(false);
    expect(first.unreadOutbound).toBeGreaterThan(0);
    expect(first.rows.some((r) => r.portalReadAt == null && r.direction === "outbound")).toBe(true);

    const marked = await markPortalCorrespondenceRead(alison, harborlineId);
    expect(marked).toBeGreaterThan(0);

    const second = await listPortalCorrespondence(alison, harborlineId);
    expect(second.unreadOutbound).toBe(0);
  });

  it("portal reads honor the kill switch", async () => {
    delete process.env.FIRMOS_PORTAL_ENABLED;
    try {
      await expect(listPortalCorrespondence(alison, harborlineId)).rejects.toBeInstanceOf(
        PortalDisabledError,
      );
    } finally {
      process.env.FIRMOS_PORTAL_ENABLED = "1";
    }
  });

  // ── Address parsing (pure) ──

  it("parses From headers in all three shapes", () => {
    expect(parseFromAddress("Alison Brewer <alison@harborline.com>")).toBe("alison@harborline.com");
    expect(parseFromAddress("<alison@harborline.com>")).toBe("alison@harborline.com");
    expect(parseFromAddress("ALISON@harborline.com")).toBe("alison@harborline.com");
    expect(parseFromAddress("not-an-address")).toBeNull();
  });

  it("exposes the thread token regex for outbound subjects", () => {
    expect(THREAD_TOKEN_RE.test("Re: Question [firmOS #t-123]")).toBe(true);
    expect(THREAD_TOKEN_RE.test("plain subject")).toBe(false);
  });
});

// ── Webhook signature + payload parsing (pure; no DB) ────────────────────

describe("resend webhook verification", () => {  const secret = `whsec_${Buffer.from("test-secret-key-material").toString("base64")}`;

  function sign(id: string, timestamp: string, body: string): string {
    const key = Buffer.from(secret.slice("whsec_".length), "base64");
    const sig = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
    return `v1,${sig}`;
  }

  it("accepts a correctly signed payload", () => {
    const body = JSON.stringify({ type: "email.received" });
    const ts = String(Math.floor(Date.now() / 1000));
    expect(
      verifySvixSignature(
        secret,
        { "svix-id": "msg_1", "svix-timestamp": ts, "svix-signature": sign("msg_1", ts, body) },
        body,
      ).ok,
    ).toBe(true);
  });

  it("rejects a tampered body and a stale timestamp", () => {
    const body = JSON.stringify({ type: "email.received" });
    const ts = String(Math.floor(Date.now() / 1000));
    const good = sign("msg_1", ts, body);
    expect(
      verifySvixSignature(
        secret,
        { "svix-id": "msg_1", "svix-timestamp": ts, "svix-signature": good },
        body + "tampered",
      ),
    ).toEqual({ ok: false, reason: "bad_signature" });

    const staleTs = String(Math.floor(Date.now() / 1000) - 60 * 60);
    expect(
      verifySvixSignature(
        secret,
        { "svix-id": "msg_1", "svix-timestamp": staleTs, "svix-signature": sign("msg_1", staleTs, body) },
        body,
      ),
    ).toEqual({ ok: false, reason: "stale_timestamp" });

    expect(verifySvixSignature(secret, { "svix-id": null }, body)).toEqual({
      ok: false,
      reason: "missing_headers",
    });
  });

  it("maps Resend email.received payloads onto the ingest input", () => {
    const parsed = parseResendInboundPayload({
      type: "email.received",
      data: {
        from: "Alison <alison@harborline.com>",
        to: ["bookkeeper@firm.example"],
        subject: "Re: Hello [firmOS #t-9]",
        text: "hi",
        headers: { "Message-ID": "<m1@x>", "In-Reply-To": "<dev-1@firmos.dev>" },
      },
    });
    expect(parsed).toMatchObject({
      from: "Alison <alison@harborline.com>",
      subject: "Re: Hello [firmOS #t-9]",
      text: "hi",
      messageId: "<m1@x>",
      inReplyTo: "<dev-1@firmos.dev>",
    });

    expect(parseResendInboundPayload({ type: "email.sent", data: {} })).toBeNull();
    expect(parseResendInboundPayload({ type: "email.received", data: { subject: "no from" } })).toBeNull();
  });
});

// ── The webhook route itself (env-gated behaviors) ───────────────────────

describe.skipIf(!reachable)("POST /api/webhooks/resend", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    savedEnv.RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET;
    await seedDatabase(TEST_TODAY);
  });
  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.unstubAllEnvs();
  });

  async function callRoute(body: string, headers: Record<string, string> = {}) {
    const { POST } = await import("@/app/api/webhooks/resend/route");
    const { NextRequest } = await import("next/server");
    const request = new NextRequest("http://localhost/api/webhooks/resend", {
      method: "POST",
      body,
      headers,
    });
    return POST(request);
  }

  it("503s in production when RESEND_WEBHOOK_SECRET is unset", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    vi.stubEnv("NODE_ENV", "production");
    try {
      const res = await callRoute(JSON.stringify({ type: "email.received", data: {} }));
      expect(res.status).toBe(503);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("accepts unsigned payloads in dev (accept-log) and ingests them", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    const res = await callRoute(
      JSON.stringify({
        type: "email.received",
        data: {
          from: "Route Test <alison@harborlinemarine.com>",
          subject: "Route-level reply",
          text: "via the unsigned dev path",
        },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ingested: boolean; matched: string };
    expect(body.ingested).toBe(true);
    expect(body.matched).toBe("sender");
  });

  it("401s a bad signature and ingests a good one when the secret is set", async () => {
    const secret = `whsec_${Buffer.from("route-test-secret").toString("base64")}`;
    process.env.RESEND_WEBHOOK_SECRET = secret;
    const payload = JSON.stringify({
      type: "email.received",
      data: { from: "alison@harborlinemarine.com", subject: "Signed reply", text: "signed" },
    });

    const ts = String(Math.floor(Date.now() / 1000));
    const bad = await callRoute(payload, {
      "svix-id": "msg_bad",
      "svix-timestamp": ts,
      "svix-signature": "v1,AAAA",
    });
    expect(bad.status).toBe(401);

    const key = Buffer.from("route-test-secret");
    const sig = createHmac("sha256", key).update(`msg_ok.${ts}.${payload}`).digest("base64");
    const good = await callRoute(payload, {
      "svix-id": "msg_ok",
      "svix-timestamp": ts,
      "svix-signature": `v1,${sig}`,
    });
    expect(good.status).toBe(200);
    const body = (await good.json()) as { ingested: boolean; matched: string };
    expect(body.ingested).toBe(true);
    expect(body.matched).toBe("sender");
  });

  it("acknowledges non-inbound events without ingesting", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    const res = await callRoute(JSON.stringify({ type: "email.delivered", data: {} }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ingested: boolean }).ingested).toBe(false);
  });
});
