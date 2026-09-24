import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  accountReconciliations,
  accounts,
  clientIntakes,
  clients,
  contactClientLinks,
  contacts,
  correspondence,
  taskNotes,
  tasks,
  users,
  weeklyBankFeeds,
} from "@/db/schema";

import { logEvent } from "./audit";
import { requireStaff, type SessionUser } from "./auth/guards";
import { localToday } from "./dates";
import { sendEmail } from "./email";
import {
  missingInfoReminderEmail,
  quoteReadyEmail,
  staffComposerEmail,
  waitingOnClientEmail,
  welcomePortalEmail,
} from "./email-templates";
import { emitNotification } from "./notifications";
import { isPortalEnabled, requirePortalClientAccess } from "./portal";
import { calculateIntakeQuoteWithConfig } from "./quote";

/**
 * Correspondence hub (walkthrough 02:28:57-02:34:03): email clients from the
 * system, keep the full history per client on BOTH surfaces (staff record +
 * client portal, government-portal unread model), thread client replies back
 * onto the work item, and badge the workstation/client list.
 *
 * Every outbound mail goes through sendAndRecord: the email driver sends
 * first, then a correspondence row is written with the outcome (sent|failed)
 * and the provider message id (thread anchor for inbound replies). Jason's
 * clients reply by plain email without logging in: outbound task-linked mail
 * carries a [firmOS #t-<id>] subject token and every outbound row stores its
 * message id, so ingestInboundEmail can match In-Reply-To/References or the
 * token back to the task.
 *
 * Read model (two independent markers on the row):
 *  - outbound rows: portal_read_at null until the client reads them;
 *  - inbound rows: staff_read_at null until staff read them;
 *  - the writer's own side is stamped at write time.
 *
 * Authorization: staff reads guard with requireStaff; portal reads go through
 * requirePortalClientAccess (kill switch + membership, §12). Job/webhook
 * internals take explicit ids and never touch request scope.
 */

export type CorrespondenceDirection = "outbound" | "inbound";
export type CorrespondenceChannel = "email" | "portal";
export type CorrespondenceStatus = "queued" | "sent" | "failed" | "received";
export type CorrespondenceTemplate =
  | "welcome"
  | "missing_info_reminder"
  | "quote_ready"
  | "waiting_on_client"
  | "staff_composer"
  | "inbound";

export type CorrespondenceRow = typeof correspondence.$inferSelect;

export class CorrespondenceError extends Error {
  constructor(
    public readonly status: 400 | 404,
    message: string,
  ) {
    super(message);
    this.name = "CorrespondenceError";
  }
}

/** Subject token inbound replies thread-match on (case-insensitive). */
export const THREAD_TOKEN_RE = /\[firmos #t-(\d+)\]/i;

export function threadTokenFor(taskId: number): string {
  return `[firmOS #t-${taskId}]`;
}

// ── Outbound ──────────────────────────────────────────────────────────────

export interface SendClientEmailInput {
  clientId: number | null;
  contactId?: number | null;
  to: string;
  subject: string;
  /** Plain-text body (stored on the row; the text part of the mail). */
  bodyText: string;
  /** Branded HTML (email-templates.ts). */
  html: string;
  template: CorrespondenceTemplate;
  taskId?: number | null;
  note?: string | null;
  intakeId?: number | null;
  portalVisible?: boolean;
  sentById?: number | null;
  now?: Date;
}

function withThreadToken(subject: string, taskId: number | null | undefined): string {
  if (taskId == null || THREAD_TOKEN_RE.test(subject)) return subject;
  return `${subject} ${threadTokenFor(taskId)}`;
}

/**
 * Send one client mail and write its correspondence row. The row is written
 * even when the driver rejects the send (status failed) so the history never
 * lies; the error then rethrows so callers can surface it. Every send is
 * audit-logged (correspondence_email_sent, metadata carries the template).
 */
async function sendAndRecord(input: SendClientEmailInput): Promise<CorrespondenceRow> {
  const now = input.now ?? new Date();
  const to = input.to.trim().toLowerCase();
  if (to === "" || !to.includes("@")) {
    throw new CorrespondenceError(400, "A valid recipient email is required");
  }
  const subject = withThreadToken(input.subject.trim(), input.taskId);
  if (subject === "") throw new CorrespondenceError(400, "Subject must not be empty");
  if (input.bodyText.trim() === "") {
    throw new CorrespondenceError(400, "Message body must not be empty");
  }

  let resendMessageId: string | null = null;
  let status: CorrespondenceStatus = "sent";
  let sendError: Error | null = null;
  try {
    resendMessageId = await sendEmail({ to, subject, html: input.html });
  } catch (err) {
    status = "failed";
    sendError = err instanceof Error ? err : new Error(String(err));
  }

  const [row] = await db
    .insert(correspondence)
    .values({
      clientId: input.clientId,
      contactId: input.contactId ?? null,
      direction: "outbound",
      channel: "email",
      subject,
      bodyText: input.bodyText,
      fromEmail: process.env.FIRMOS_EMAIL_FROM ?? null,
      toEmail: to,
      taskId: input.taskId ?? null,
      note: input.note ?? (sendError ? `send failed: ${sendError.message}` : null),
      template: input.template,
      status,
      resendMessageId,
      portalVisible: input.portalVisible ?? true,
      sentById: input.sentById ?? null,
      intakeId: input.intakeId ?? null,
      // The writer's side is read by construction; the client side starts unread.
      staffReadAt: now,
      portalReadAt: null,
      createdAt: now,
    })
    .returning();

  await logEvent({
    userId: input.sentById ?? null,
    action: "correspondence_email_sent",
    entityType: "correspondence",
    entityId: row.id,
    metadata: {
      template: input.template,
      clientId: input.clientId,
      to,
      status,
      ...(input.taskId != null ? { taskId: input.taskId } : {}),
    },
  });

  if (sendError) throw sendError;
  return row;
}

/** A client's mail target: the primary contact when it has an email, else the first linked contact with one. */
async function mailContactFor(
  clientId: number,
): Promise<{ contact: typeof contacts.$inferSelect; email: string } | null> {
  const rows = await db
    .select({ contact: contacts, isPrimary: sql<boolean>`${clients.primaryContactId} = ${contacts.id}` })
    .from(contactClientLinks)
    .innerJoin(contacts, eq(contacts.id, contactClientLinks.contactId))
    .innerJoin(clients, eq(clients.id, contactClientLinks.clientId))
    .where(eq(contactClientLinks.clientId, clientId));
  const withEmail = rows.filter((r) => r.contact.email != null && r.contact.email.trim() !== "");
  const picked = withEmail.find((r) => r.isPrimary) ?? withEmail[0];
  if (!picked) return null;
  return { contact: picked.contact, email: picked.contact.email as string };
}

function contactFirstName(contact: typeof contacts.$inferSelect): string | null {
  if (contact.type === "entity") return null;
  return contact.firstName;
}

export type SendWelcomeResult =
  | { sent: true; correspondenceId: number }
  | { sent: false; reason: "portal_disabled" | "no_contact_email" | "client_not_found" };

/**
 * (a) Welcome / portal-setup mail. Respects the §12 kill switch: a disabled
 * portal means there is nothing to point the client at, so nothing sends.
 */
export async function sendWelcomeEmail(
  clientId: number,
  sentById: number | null,
  now: Date = new Date(),
): Promise<SendWelcomeResult> {
  if (!(await isPortalEnabled())) return { sent: false, reason: "portal_disabled" };
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) return { sent: false, reason: "client_not_found" };
  const target = await mailContactFor(clientId);
  if (!target) return { sent: false, reason: "no_contact_email" };

  const clientName = client.dbaName ?? client.legalName;
  const mail = welcomePortalEmail({
    clientName,
    contactFirstName: contactFirstName(target.contact),
  });
  const row = await sendAndRecord({
    clientId,
    contactId: target.contact.id,
    to: target.email,
    subject: mail.subject,
    bodyText: mail.text,
    html: mail.html,
    template: "welcome",
    sentById,
    now,
  });
  return { sent: true, correspondenceId: row.id };
}

/** (b) Missing-info reminder: lists the open items, links the portal. */
export async function sendMissingInfoReminder(
  clientId: number,
  items: string[],
  sentById: number | null,
  now: Date = new Date(),
): Promise<CorrespondenceRow | null> {
  if (items.length === 0) return null;
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) throw new CorrespondenceError(404, `Client ${clientId} not found`);
  const target = await mailContactFor(clientId);
  if (!target) return null;

  const clientName = client.dbaName ?? client.legalName;
  const mail = missingInfoReminderEmail({
    clientName,
    items,
    includePortalLink: await isPortalEnabled(),
  });
  return sendAndRecord({
    clientId,
    contactId: target.contact.id,
    to: target.email,
    subject: mail.subject,
    bodyText: mail.text,
    html: mail.html,
    template: "missing_info_reminder",
    sentById,
    now,
  });
}

function moneyText(amount: number | null): string {
  if (amount == null) return "included";
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * (c) Quote mail for an intake (pre-conversion, so the row links by
 * intake_id; conversion backfills client_id). Recipient: the intake's
 * primary contact, else its first contact with an email.
 */
export async function sendQuoteReadyEmail(
  intakeId: number,
  sentById: number | null,
  now: Date = new Date(),
): Promise<CorrespondenceRow> {
  const [intake] = await db
    .select()
    .from(clientIntakes)
    .where(eq(clientIntakes.id, intakeId))
    .limit(1);
  if (!intake) throw new CorrespondenceError(404, `Intake ${intakeId} not found`);

  const form = (intake.formData ?? {}) as {
    contacts?: { firstName?: string; email?: string; isPrimary?: boolean }[];
    reportDefinitions?: { name: string; frequency: string }[] | null;
  };
  const withEmail = (form.contacts ?? []).filter(
    (c) => typeof c.email === "string" && c.email.includes("@"),
  );
  const target = withEmail.find((c) => c.isPrimary) ?? withEmail[0];
  if (!target?.email) {
    throw new CorrespondenceError(400, "This intake has no contact with an email address");
  }

  const today = localToday(now);
  const quote = await calculateIntakeQuoteWithConfig(
    {
      ...(form as object),
      reportDefinitions: form.reportDefinitions ?? undefined,
      bookkeepingFrequency: intake.bookkeepingFrequency,
    } as Parameters<typeof calculateIntakeQuoteWithConfig>[0],
    today,
  );
  const clientName = intake.dbaName ?? intake.legalName;
  const lines = quote.lines
    .filter((l) => l.quantity > 0)
    .map((l) => ({
      name: l.product_name,
      amount: moneyText(l.amount == null ? null : Math.max(0, l.amount - (l.discount ?? 0))),
    }));
  const mail = quoteReadyEmail({
    clientName,
    lines,
    totalLabel: `${moneyText(quote.totals.effectiveMonthly)}/mo`,
    includePortalLink: await isPortalEnabled(),
  });
  return sendAndRecord({
    clientId: intake.clientId ?? null,
    to: target.email,
    subject: mail.subject,
    bodyText: mail.text,
    html: mail.html,
    template: "quote_ready",
    intakeId,
    note: `intake #${intakeId} proposal`,
    sentById,
    now,
  });
}

export interface ComposerInput {
  clientId: number;
  contactId: number;
  subject: string;
  bodyText: string;
  /** Link to a waiting-on-client task; switches the template + thread token on. */
  taskId?: number | null;
  sentById: number | null;
  now?: Date;
}

/**
 * The staff composer (and (d) waiting-on-client question mail): validates
 * the recipient belongs to the client, picks the template (a linked waiting
 * task gets the question template, thread token, and reply instruction), and
 * sends through sendAndRecord.
 */
export async function sendComposerEmail(input: ComposerInput): Promise<CorrespondenceRow> {
  const [client] = await db.select().from(clients).where(eq(clients.id, input.clientId)).limit(1);
  if (!client) throw new CorrespondenceError(404, `Client ${input.clientId} not found`);

  const [link] = await db
    .select({ contact: contacts })
    .from(contactClientLinks)
    .innerJoin(contacts, eq(contacts.id, contactClientLinks.contactId))
    .where(
      and(eq(contactClientLinks.clientId, input.clientId), eq(contactClientLinks.contactId, input.contactId)),
    )
    .limit(1);
  if (!link) {
    throw new CorrespondenceError(400, "That contact is not linked to this client");
  }
  const to = link.contact.email?.trim() ?? "";
  if (to === "") {
    throw new CorrespondenceError(400, "That contact has no email address on file");
  }

  let taskId: number | null = null;
  if (input.taskId != null) {
    const [task] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, input.taskId), eq(tasks.clientId, input.clientId), isNull(tasks.deletedAt)))
      .limit(1);
    if (!task) throw new CorrespondenceError(400, "That work item does not belong to this client");
    taskId = task.id;
  }

  const clientName = client.dbaName ?? client.legalName;
  if (taskId != null) {
    const mail = waitingOnClientEmail({ clientName, question: input.bodyText.trim() });
    return sendAndRecord({
      clientId: input.clientId,
      contactId: input.contactId,
      to,
      subject: input.subject,
      bodyText: mail.text,
      html: mail.html,
      template: "waiting_on_client",
      taskId,
      sentById: input.sentById,
      now: input.now,
    });
  }
  return sendAndRecord({
    clientId: input.clientId,
    contactId: input.contactId,
    to,
    subject: input.subject,
    bodyText: input.bodyText.trim(),
    html: staffComposerEmail({ bodyText: input.bodyText.trim() }),
    template: "staff_composer",
    sentById: input.sentById,
    now: input.now,
  });
}

// ── Staff reads + read markers ────────────────────────────────────────────

export interface CorrespondenceItem {
  id: number;
  direction: CorrespondenceDirection;
  channel: CorrespondenceChannel;
  subject: string | null;
  bodyText: string;
  fromEmail: string | null;
  toEmail: string | null;
  status: CorrespondenceStatus;
  template: string;
  taskId: number | null;
  taskTitle: string | null;
  contactName: string | null;
  sentByName: string | null;
  portalVisible: boolean;
  staffReadAt: string | null;
  portalReadAt: string | null;
  createdAt: string;
}

export interface ClientCorrespondence {
  rows: CorrespondenceItem[];
  /** Unread inbound replies - the badge count. */
  unreadInbound: number;
}

function contactLabel(c: typeof contacts.$inferSelect | null): string | null {
  if (!c) return null;
  return c.type === "entity"
    ? (c.entityName ?? null)
    : ([c.firstName, c.lastName].filter(Boolean).join(" ") || null);
}

/** Full client history for the staff tab (staff-guarded, §11). */
export async function listClientCorrespondence(clientId: number): Promise<ClientCorrespondence> {
  await requireStaff();
  const rows = await db
    .select({
      row: correspondence,
      contact: contacts,
      taskTitle: tasks.title,
      sentBy: users,
    })
    .from(correspondence)
    .leftJoin(contacts, eq(contacts.id, correspondence.contactId))
    .leftJoin(tasks, eq(tasks.id, correspondence.taskId))
    .leftJoin(users, eq(users.id, correspondence.sentById))
    .where(eq(correspondence.clientId, clientId))
    .orderBy(desc(correspondence.createdAt), desc(correspondence.id));

  return {
    rows: rows.map(({ row, contact, taskTitle, sentBy }) => ({
      id: row.id,
      direction: row.direction as CorrespondenceDirection,
      channel: row.channel as CorrespondenceChannel,
      subject: row.subject,
      bodyText: row.bodyText,
      fromEmail: row.fromEmail,
      toEmail: row.toEmail,
      status: row.status as CorrespondenceStatus,
      template: row.template,
      taskId: row.taskId,
      taskTitle,
      contactName: contactLabel(contact),
      sentByName: sentBy ? `${sentBy.firstName} ${sentBy.lastName}`.trim() : null,
      portalVisible: row.portalVisible,
      staffReadAt: row.staffReadAt ? row.staffReadAt.toISOString() : null,
      portalReadAt: row.portalReadAt ? row.portalReadAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    })),
    unreadInbound: rows.filter((r) => r.row.direction === "inbound" && r.row.staffReadAt == null)
      .length,
  };
}

/**
 * Unread inbound counts per client - the workstation/client-list badge read.
 * One grouped query; callers are already staff-guarded surfaces.
 */
export async function getUnreadInboundByClient(): Promise<Map<number, number>> {
  const rows = await db
    .select({ clientId: correspondence.clientId, count: sql<number>`count(*)::int` })
    .from(correspondence)
    .where(
      and(
        eq(correspondence.direction, "inbound"),
        isNull(correspondence.staffReadAt),
        sql`${correspondence.clientId} is not null`,
      ),
    )
    .groupBy(correspondence.clientId);
  return new Map(rows.map((r) => [r.clientId as number, r.count]));
}

/** Staff opened the correspondence tab: inbound replies for the client are read. */
export async function markStaffCorrespondenceRead(
  clientId: number,
  now: Date = new Date(),
): Promise<number> {
  const updated = await db
    .update(correspondence)
    .set({ staffReadAt: now })
    .where(
      and(
        eq(correspondence.clientId, clientId),
        eq(correspondence.direction, "inbound"),
        isNull(correspondence.staffReadAt),
      ),
    )
    .returning({ id: correspondence.id });
  return updated.length;
}

// ── Portal reads + read markers ───────────────────────────────────────────

export interface PortalCorrespondence {
  rows: CorrespondenceItem[];
  /** Unread firm mail - the portal badge count. */
  unreadOutbound: number;
}

/**
 * Portal correspondence history (§12): membership-validated, portal_visible
 * rows only - staff-internal notes (portal_visible = false) never cross.
 */
export async function listPortalCorrespondence(
  user: SessionUser,
  clientId: number,
): Promise<PortalCorrespondence> {
  await requirePortalClientAccess(user, clientId);
  const rows = await db
    .select({ row: correspondence, sentBy: users })
    .from(correspondence)
    .leftJoin(users, eq(users.id, correspondence.sentById))
    .where(and(eq(correspondence.clientId, clientId), eq(correspondence.portalVisible, true)))
    .orderBy(desc(correspondence.createdAt), desc(correspondence.id));

  return {
    rows: rows.map(({ row, sentBy }) => ({
      id: row.id,
      direction: row.direction as CorrespondenceDirection,
      channel: row.channel as CorrespondenceChannel,
      subject: row.subject,
      bodyText: row.bodyText,
      fromEmail: row.fromEmail,
      toEmail: row.toEmail,
      status: row.status as CorrespondenceStatus,
      template: row.template,
      taskId: row.taskId,
      taskTitle: null, // staff-only context - never crosses into the portal
      contactName: null,
      sentByName: sentBy ? sentBy.firstName : null, // first name only (§12)
      portalVisible: row.portalVisible,
      staffReadAt: null,
      portalReadAt: row.portalReadAt ? row.portalReadAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    })),
    unreadOutbound: rows.filter(
      (r) => r.row.direction === "outbound" && r.row.portalReadAt == null,
    ).length,
  };
}

/** The badge number alone (portal shell/home). */
export async function getPortalUnreadCorrespondence(
  user: SessionUser,
  clientId: number,
): Promise<number> {
  await requirePortalClientAccess(user, clientId);
  const rows = await db
    .select({ id: correspondence.id })
    .from(correspondence)
    .where(
      and(
        eq(correspondence.clientId, clientId),
        eq(correspondence.portalVisible, true),
        eq(correspondence.direction, "outbound"),
        isNull(correspondence.portalReadAt),
      ),
    );
  return rows.length;
}

/** Reading marks read: stamp portal_read_at on the client's unread firm mail. */
export async function markPortalCorrespondenceRead(
  user: SessionUser,
  clientId: number,
  now: Date = new Date(),
): Promise<number> {
  await requirePortalClientAccess(user, clientId);
  const updated = await db
    .update(correspondence)
    .set({ portalReadAt: now })
    .where(
      and(
        eq(correspondence.clientId, clientId),
        eq(correspondence.portalVisible, true),
        eq(correspondence.direction, "outbound"),
        isNull(correspondence.portalReadAt),
      ),
    )
    .returning({ id: correspondence.id });
  return updated.length;
}

// ── Inbound reply ingest ──────────────────────────────────────────────────

export interface InboundEmailInput {
  from: string;
  to?: string | string[] | null;
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  /** RFC 822 Message-ID of the inbound message. */
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string | string[] | null;
}

export interface IngestResult {
  correspondenceId: number;
  clientId: number | null;
  contactId: number | null;
  taskId: number | null;
  /** thread = matched a task; sender = matched only the contact; none = triage. */
  matched: "thread" | "sender" | "none";
}

/** "Name <addr@x>" | "<addr@x>" | "addr@x" -> bare lowercase address, or null. */
export function parseFromAddress(from: string): string | null {
  const bracketed = /<([^>]+)>/.exec(from);
  const raw = (bracketed ? bracketed[1] : from).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw : null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function referenceIds(input: InboundEmailInput): string[] {
  const refs = Array.isArray(input.references)
    ? input.references
    : typeof input.references === "string"
      ? input.references.split(/\s+/)
      : [];
  const raw = [input.inReplyTo ?? "", ...refs];
  // Headers carry <id@host>; the stored resend_message_id is the bare id.
  return raw
    .flatMap((r) => r.split(/\s+/))
    .map((r) => r.trim().replace(/^<|>$/g, ""))
    .filter((r) => r !== "");
}

async function notifyUsers(
  userIds: (number | null)[],
  notice: { type: string; title: string; message: string; link: string; entityId: number },
  now: Date,
): Promise<void> {
  for (const userId of [...new Set(userIds)].filter((v): v is number => v != null)) {
    await emitNotification(
      {
        userId,
        type: notice.type,
        title: notice.title,
        message: notice.message,
        link: notice.link,
        entityType: "correspondence",
        entityId: notice.entityId,
      },
      now,
    );
  }
}

/**
 * Inbound client reply (Jason's clients never log in - the reply path must
 * work from plain email). Matching order:
 *  1. thread: [firmOS #t-<id>] subject token, else In-Reply-To/References
 *     against stored outbound message ids;
 *  2. sender: the From address on a contact (its first linked client);
 *  3. none: correspondence with no client + a triage notification to admins.
 * A thread-matched reply also lands as a task note (author null = client)
 * and notifies the assignee/bookkeeper plus the manager.
 */
export async function ingestInboundEmail(
  input: InboundEmailInput,
  now: Date = new Date(),
): Promise<IngestResult> {
  const fromEmail = parseFromAddress(input.from ?? "");
  if (!fromEmail) throw new CorrespondenceError(400, "Unparseable From address");
  const bodyText =
    input.text?.trim() || (input.html ? stripHtml(input.html) : "") || "(no text body)";
  const subject = input.subject?.trim() ?? "";

  // 1. Thread matching.
  let task: typeof tasks.$inferSelect | null = null;
  const tokenMatch = THREAD_TOKEN_RE.exec(subject);
  if (tokenMatch) {
    const taskId = Number(tokenMatch[1]);
    const [row] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)))
      .limit(1);
    task = row ?? null;
  }
  let anchor: CorrespondenceRow | null = null;
  if (task == null) {
    const refs = referenceIds(input);
    if (refs.length > 0) {
      const anchors = await db
        .select()
        .from(correspondence)
        .where(inArray(correspondence.resendMessageId, refs))
        .orderBy(desc(correspondence.id))
        .limit(1);
      anchor = anchors[0] ?? null;
      if (anchor?.taskId != null) {
        const [row] = await db
          .select()
          .from(tasks)
          .where(and(eq(tasks.id, anchor.taskId), isNull(tasks.deletedAt)))
          .limit(1);
        task = row ?? null;
      }
    }
  }

  // 2. Sender matching.
  const [contact] = await db
    .select()
    .from(contacts)
    .where(sql`lower(${contacts.email}) = ${fromEmail}`)
    .limit(1);
  let clientId = task?.clientId ?? anchor?.clientId ?? null;
  if (clientId == null && contact) {
    const [link] = await db
      .select({ clientId: contactClientLinks.clientId })
      .from(contactClientLinks)
      .where(eq(contactClientLinks.contactId, contact.id))
      .orderBy(contactClientLinks.id)
      .limit(1);
    clientId = link?.clientId ?? null;
  }
  const matched: IngestResult["matched"] = task != null ? "thread" : contact || clientId ? "sender" : "none";

  const [row] = await db
    .insert(correspondence)
    .values({
      clientId,
      contactId: contact?.id ?? anchor?.contactId ?? null,
      direction: "inbound",
      channel: "email",
      subject: subject === "" ? null : subject,
      bodyText,
      fromEmail,
      toEmail: Array.isArray(input.to) ? input.to.join(", ") : (input.to ?? null),
      taskId: task?.id ?? null,
      template: "inbound",
      status: "received",
      resendMessageId: input.messageId ?? null,
      portalVisible: true,
      // The client wrote it; the staff side starts unread (the badge).
      portalReadAt: now,
      staffReadAt: null,
      createdAt: now,
    })
    .returning();

  await logEvent({
    action: "correspondence_inbound_received",
    entityType: "correspondence",
    entityId: row.id,
    metadata: { fromEmail, clientId, taskId: task?.id ?? null, matched },
  });

  // Task note + staff notification fan-out.
  const snippet = bodyText.length > 240 ? `${bodyText.slice(0, 240)}…` : bodyText;
  const senderLabel = contact ? (contactLabel(contact) ?? fromEmail) : fromEmail;
  if (task) {
    await db.insert(taskNotes).values({
      taskId: task.id,
      authorId: null, // client replies have no staff author
      body: `Reply from ${senderLabel}:\n\n${bodyText}`,
    });
  }
  if (clientId != null) {
    const [client] = await db
      .select({ bookkeeperId: clients.bookkeeperId, managerId: clients.managerId })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    await notifyUsers(
      [task?.assigneeId ?? null, client?.bookkeeperId ?? null, client?.managerId ?? null],
      {
        type: "client_reply",
        title: `Reply from ${senderLabel}${task ? `: ${task.title}` : ""}`,
        message: snippet,
        link: `/clients/${clientId}?tab=correspondence`,
        entityId: row.id,
      },
      now,
    );
  } else {
    const admins = await db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.role, ["admin", "owner"]), eq(users.isActive, true)));
    await notifyUsers(
      admins.map((a) => a.id),
      {
        type: "correspondence_triage",
        title: `Unmatched reply from ${senderLabel}`,
        message: snippet,
        link: "/contacts",
        entityId: row.id,
      },
      now,
    );
  }

  return {
    correspondenceId: row.id,
    clientId,
    contactId: row.contactId,
    taskId: task?.id ?? null,
    matched,
  };
}

// ── Missing-info reminder computation (the daily job reads this) ──────────

/** Reminder cadence: at most one reminder mail per client per this many days. */
export const REMINDER_CADENCE_DAYS = 3;
/** New clients get this many days before the "portal not activated" reason kicks in. */
export const PORTAL_ACTIVATION_GRACE_DAYS = 3;

export interface ClientReminderPlan {
  clientId: number;
  clientName: string;
  contactId: number;
  to: string;
  reasons: string[];
}

/**
 * Clients with missing required onboarding info (active, not paused):
 *  - portal not activated: portal enabled, client older than the grace
 *    period, and no linked client-role login has ever signed in;
 *  - account confirmations missing: active accounts with no statement day.
 * Cadence: skipped when a missing_info_reminder mail went out within the
 * last REMINDER_CADENCE_DAYS days (the correspondence row is the dedup record).
 */
export async function computeMissingInfoReminders(now: Date = new Date()): Promise<{
  plans: ClientReminderPlan[];
  skipped: { clientId: number; reason: string }[];
}> {
  const clientRows = await db
    .select()
    .from(clients)
    .where(and(eq(clients.isActive, true), eq(clients.isPaused, false)));
  if (clientRows.length === 0) return { plans: [], skipped: [] };

  const clientIds = clientRows.map((c) => c.id);
  const [linkRows, accountRows, reminderRows] = await Promise.all([
    db
      .select({ clientId: contactClientLinks.clientId, contact: contacts })
      .from(contactClientLinks)
      .innerJoin(contacts, eq(contacts.id, contactClientLinks.contactId))
      .where(inArray(contactClientLinks.clientId, clientIds)),
    db
      .select({
        clientId: accounts.clientId,
        statementDay: accounts.statementDay,
        requiresManual: accounts.requiresManualTransactions,
      })
      .from(accounts)
      .where(and(inArray(accounts.clientId, clientIds), eq(accounts.isActive, true))),
    db
      .select({ clientId: correspondence.clientId, createdAt: correspondence.createdAt })
      .from(correspondence)
      .where(
        and(
          inArray(correspondence.clientId, clientIds),
          eq(correspondence.template, "missing_info_reminder"),
          eq(correspondence.direction, "outbound"),
        ),
      )
      .orderBy(desc(correspondence.createdAt)),
  ]);

  // Latest reminder per client (rows arrived newest-first).
  const lastReminderByClient = new Map<number, Date>();
  for (const r of reminderRows) {
    if (r.clientId != null && !lastReminderByClient.has(r.clientId)) {
      lastReminderByClient.set(r.clientId, r.createdAt);
    }
  }

  const unconfirmedByClient = new Map<number, number>();
  for (const a of accountRows) {
    // Accounts the firm downloads by hand carry no statement day by design.
    if (a.statementDay == null && !a.requiresManual) {
      unconfirmedByClient.set(a.clientId, (unconfirmedByClient.get(a.clientId) ?? 0) + 1);
    }
  }

  const portalOn = await isPortalEnabled();
  const graceCutoff = new Date(now.getTime() - PORTAL_ACTIVATION_GRACE_DAYS * 24 * 60 * 60_000);
  const cadenceCutoff = new Date(now.getTime() - REMINDER_CADENCE_DAYS * 24 * 60 * 60_000);

  // Portal activation: any client-role user linked to one of the client's
  // contacts who has logged in at least once.
  const allContactIds = [...new Set(linkRows.map((l) => l.contact.id))];
  const portalUserRows =
    portalOn && allContactIds.length > 0
      ? await db
          .select({ contactId: users.contactId, lastLoginAt: users.lastLoginAt })
          .from(users)
          .where(and(eq(users.role, "client"), inArray(users.contactId, allContactIds)))
      : [];
  const activatedContactIds = new Set(
    portalUserRows.filter((u) => u.lastLoginAt != null).map((u) => u.contactId),
  );

  const plans: ClientReminderPlan[] = [];
  const skipped: { clientId: number; reason: string }[] = [];
  for (const client of clientRows) {
    const links = linkRows.filter((l) => l.clientId === client.id);
    const withEmail = links.filter((l) => l.contact.email != null && l.contact.email.trim() !== "");
    const target =
      withEmail.find((l) => client.primaryContactId === l.contact.id) ?? withEmail[0];
    if (!target) {
      skipped.push({ clientId: client.id, reason: "no_contact_email" });
      continue;
    }

    const reasons: string[] = [];
    if (
      portalOn &&
      client.createdAt <= graceCutoff &&
      !links.some((l) => activatedContactIds.has(l.contact.id))
    ) {
      reasons.push("Set up your portal login - it takes a minute and shows you everything we need.");
    }
    const unconfirmed = unconfirmedByClient.get(client.id) ?? 0;
    if (unconfirmed > 0) {
      reasons.push(
        `Confirm the statement details for ${unconfirmed} account${unconfirmed === 1 ? "" : "s"}.`,
      );
    }
    if (reasons.length === 0) {
      skipped.push({ clientId: client.id, reason: "nothing_missing" });
      continue;
    }

    const last = lastReminderByClient.get(client.id);
    if (last != null && last > cadenceCutoff) {
      skipped.push({ clientId: client.id, reason: "cadence" });
      continue;
    }
    plans.push({
      clientId: client.id,
      clientName: client.dbaName ?? client.legalName,
      contactId: target.contact.id,
      to: target.contact.email as string,
      reasons,
    });
  }
  return { plans, skipped };
}

// ── Waiting-on-client context for the composer (parked rows) ──────────────

export interface WaitingContextItem {
  kind: "task" | "bank_feed" | "reconciliation";
  id: number;
  title: string;
  note: string | null;
}

/**
 * Everything parked on the client right now - feeds, reconciliations, and
 * waiting tasks. The composer offers these as the optional link; tasks link
 * by task_id (thread token), parked periodic rows ride along as context.
 */
export async function listWaitingContext(clientId: number): Promise<WaitingContextItem[]> {
  const [taskRows, feedRows, reconRows] = await Promise.all([
    db
      .select({ id: tasks.id, title: tasks.title })
      .from(tasks)
      .where(
        and(
          eq(tasks.clientId, clientId),
          eq(tasks.status, "waiting_on_client"),
          isNull(tasks.deletedAt),
        ),
      )
      .orderBy(desc(tasks.id)),
    db
      .select({
        id: weeklyBankFeeds.id,
        weekStartDate: weeklyBankFeeds.weekStartDate,
        note: weeklyBankFeeds.clientNote,
      })
      .from(weeklyBankFeeds)
      .where(
        and(
          eq(weeklyBankFeeds.clientId, clientId),
          eq(weeklyBankFeeds.waitingOnClient, true),
          isNull(weeklyBankFeeds.completedAt),
        ),
      ),
    db
      .select({ id: accountReconciliations.id, accountName: accounts.name, note: accountReconciliations.clientNote })
      .from(accountReconciliations)
      .innerJoin(accounts, eq(accounts.id, accountReconciliations.accountId))
      .where(
        and(
          eq(accountReconciliations.clientId, clientId),
          eq(accountReconciliations.waitingOnClient, true),
          isNull(accountReconciliations.completedAt),
        ),
      ),
  ]);
  return [
    ...taskRows.map((t) => ({ kind: "task" as const, id: t.id, title: t.title, note: null })),
    ...feedRows.map((f) => ({
      kind: "bank_feed" as const,
      id: f.id,
      title: `Bank feed week of ${f.weekStartDate}`,
      note: f.note,
    })),
    ...reconRows.map((r) => ({
      kind: "reconciliation" as const,
      id: r.id,
      title: `Reconcile ${r.accountName}`,
      note: r.note,
    })),
  ];
}
