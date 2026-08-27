import { and, asc, eq, sql } from "drizzle-orm";
import { formatLocalDate, type LocalDate } from "@firmos/domain";

import { db } from "@/db";
import { clients, w9Recipients } from "@/db/schema";

import { logEvent } from "./audit";
import { localToday } from "./dates";
import { uploadDocument } from "./documents";
import { sendEmail } from "./email";

/**
 * W-9 / 1099 tracking (HANDOFF §18).
 *
 * Statuses: pending_w9 → w9_received → 1099_sent. The $600 threshold governs
 * the summary counts and the Oregon CSV export (recipients in OR needing a
 * 1099 with at least $600 paid). Uploading the W-9 creates a Document with
 * doc_type='w9' linked to the recipient. W-9 requests are emailed on demand
 * to a manually supplied address - there is no automated reminder job.
 */

export class W9Error extends Error {
  constructor(
    public readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "W9Error";
  }
}

export type W9RecipientRow = typeof w9Recipients.$inferSelect;

/** §18 - the federal 1099-NEC reporting threshold. */
export const W9_1099_THRESHOLD = 600;

function totalPaidOf(row: Pick<W9RecipientRow, "totalPaid">): number {
  return Number(row.totalPaid);
}

/**
 * §18 - the manual override wins when set; otherwise the flag derives from
 * the $600 threshold.
 */
export function effectiveNeeds1099(
  row: Pick<W9RecipientRow, "totalPaid" | "needs1099ManualOverride">,
): boolean {
  return row.needs1099ManualOverride ?? totalPaidOf(row) >= W9_1099_THRESHOLD;
}

async function requireRecipient(recipientId: number): Promise<W9RecipientRow> {
  const [row] = await db.select().from(w9Recipients).where(eq(w9Recipients.id, recipientId)).limit(1);
  if (!row) throw new W9Error(404, `W-9 recipient ${recipientId} not found`);
  return row;
}

// ── CRUD (§18) ────────────────────────────────────────────────────────────

export async function listW9Recipients(year: number, clientId?: number): Promise<W9RecipientRow[]> {
  const where = clientId != null ? and(eq(w9Recipients.year, year), eq(w9Recipients.clientId, clientId)) : eq(w9Recipients.year, year);
  return db
    .select()
    .from(w9Recipients)
    .where(where)
    .orderBy(asc(w9Recipients.vendorName), asc(w9Recipients.id));
}

export interface W9RecipientInput {
  clientId: number;
  vendorName: string;
  year: number;
  email?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  taxId?: string | null;
  totalPaid?: string | number;
  paymentType?: string | null;
  needs1099ManualOverride?: boolean | null;
}

export async function createW9Recipient(userId: number, input: W9RecipientInput): Promise<W9RecipientRow> {
  const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, input.clientId)).limit(1);
  if (!client) throw new W9Error(404, `Client ${input.clientId} not found`);
  if (input.vendorName.trim() === "") throw new W9Error(400, "Vendor name must not be empty");

  const totalPaid = input.totalPaid == null ? "0" : String(input.totalPaid);
  if (Number.isNaN(Number(totalPaid))) throw new W9Error(400, "total_paid must be a number");

  const [row] = await db
    .insert(w9Recipients)
    .values({
      clientId: input.clientId,
      vendorName: input.vendorName.trim(),
      year: input.year,
      email: input.email ?? null,
      addressLine1: input.addressLine1 ?? null,
      addressLine2: input.addressLine2 ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      zip: input.zip ?? null,
      taxId: input.taxId ?? null,
      totalPaid,
      paymentType: input.paymentType ?? null,
      needs1099ManualOverride: input.needs1099ManualOverride ?? null,
      needs1099: input.needs1099ManualOverride ?? Number(totalPaid) >= W9_1099_THRESHOLD,
      status: "pending_w9",
    })
    .returning();
  await logEvent({
    userId,
    action: "w9_recipient_created",
    entityType: "w9_recipient",
    entityId: row.id,
    metadata: { clientId: input.clientId, year: input.year },
  });
  return row;
}

export async function updateW9Recipient(
  userId: number,
  recipientId: number,
  patch: Partial<Omit<W9RecipientInput, "clientId" | "year">>,
): Promise<W9RecipientRow> {
  const existing = await requireRecipient(recipientId);
  const totalPaid = patch.totalPaid == null ? existing.totalPaid : String(patch.totalPaid);
  if (Number.isNaN(Number(totalPaid))) throw new W9Error(400, "total_paid must be a number");
  const override = patch.needs1099ManualOverride !== undefined ? patch.needs1099ManualOverride : existing.needs1099ManualOverride;

  const [updated] = await db
    .update(w9Recipients)
    .set({
      vendorName: patch.vendorName?.trim() ?? existing.vendorName,
      email: patch.email !== undefined ? patch.email : existing.email,
      addressLine1: patch.addressLine1 !== undefined ? patch.addressLine1 : existing.addressLine1,
      addressLine2: patch.addressLine2 !== undefined ? patch.addressLine2 : existing.addressLine2,
      city: patch.city !== undefined ? patch.city : existing.city,
      state: patch.state !== undefined ? patch.state : existing.state,
      zip: patch.zip !== undefined ? patch.zip : existing.zip,
      taxId: patch.taxId !== undefined ? patch.taxId : existing.taxId,
      totalPaid,
      paymentType: patch.paymentType !== undefined ? patch.paymentType : existing.paymentType,
      needs1099ManualOverride: override,
      needs1099: override ?? Number(totalPaid) >= W9_1099_THRESHOLD,
      updatedAt: new Date(),
    })
    .where(eq(w9Recipients.id, recipientId))
    .returning();
  await logEvent({ userId, action: "w9_recipient_updated", entityType: "w9_recipient", entityId: recipientId });
  return updated;
}

export async function deleteW9Recipient(userId: number, recipientId: number): Promise<void> {
  const [deleted] = await db.delete(w9Recipients).where(eq(w9Recipients.id, recipientId)).returning({ id: w9Recipients.id });
  if (!deleted) throw new W9Error(404, `W-9 recipient ${recipientId} not found`);
  await logEvent({ userId, action: "w9_recipient_deleted", entityType: "w9_recipient", entityId: recipientId });
}

// ── Status flow (§18: pending_w9 → w9_received → 1099_sent) ───────────────

export async function markW9Received(
  recipientId: number,
  userId: number,
  receivedDate?: string,
  today: LocalDate = localToday(),
): Promise<W9RecipientRow> {
  const row = await requireRecipient(recipientId);
  if (row.status !== "pending_w9") {
    throw new W9Error(409, `Recipient ${recipientId} is already ${row.status}`);
  }
  const [updated] = await db
    .update(w9Recipients)
    .set({ status: "w9_received", w9ReceivedDate: receivedDate ?? formatLocalDate(today), updatedAt: new Date() })
    .where(eq(w9Recipients.id, recipientId))
    .returning();
  await logEvent({
    userId,
    action: "w9_received",
    entityType: "w9_recipient",
    entityId: recipientId,
    metadata: { clientId: row.clientId, year: row.year },
  });
  return updated;
}

/**
 * §18 - uploading the W-9 creates a Document with doc_type='w9' and links it
 * to the recipient. An upload implies receipt: a pending_w9 recipient moves
 * to w9_received with the upload date.
 */
export async function uploadW9Document(
  recipientId: number,
  file: { fileName: string; bytes: Uint8Array; mimeType?: string | null },
  uploadedById: number,
  today: LocalDate = localToday(),
): Promise<{ recipient: W9RecipientRow; documentId: number }> {
  const row = await requireRecipient(recipientId);
  const document = await uploadDocument({
    clientId: row.clientId,
    uploadedById,
    fileName: file.fileName,
    mimeType: file.mimeType ?? null,
    bytes: file.bytes,
    folder: "Tax",
    docType: "w9",
    today,
  });

  const [updated] = await db
    .update(w9Recipients)
    .set({
      w9DocumentId: document.id,
      ...(row.status === "pending_w9"
        ? { status: "w9_received" as const, w9ReceivedDate: formatLocalDate(today) }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(w9Recipients.id, recipientId))
    .returning();

  await logEvent({
    userId: uploadedById,
    action: "w9_document_uploaded",
    entityType: "w9_recipient",
    entityId: recipientId,
    metadata: { clientId: row.clientId, documentId: document.id },
  });
  return { recipient: updated, documentId: document.id };
}

export async function mark1099Sent(
  recipientId: number,
  userId: number,
  sentDate?: string,
  today: LocalDate = localToday(),
): Promise<W9RecipientRow> {
  const row = await requireRecipient(recipientId);
  if (row.status !== "w9_received") {
    throw new W9Error(409, `Recipient ${recipientId} must be w9_received before the 1099 can be sent (now ${row.status})`);
  }
  const [updated] = await db
    .update(w9Recipients)
    .set({ status: "1099_sent", form1099SentDate: sentDate ?? formatLocalDate(today), updatedAt: new Date() })
    .where(eq(w9Recipients.id, recipientId))
    .returning();
  await logEvent({
    userId,
    action: "1099_sent",
    entityType: "w9_recipient",
    entityId: recipientId,
    metadata: { clientId: row.clientId, year: row.year },
  });
  return updated;
}

// ── Summary + Oregon export (§18, $600 threshold) ─────────────────────────

export interface W9Summary {
  year: number;
  total: number;
  pendingW9: number;
  w9Received: number;
  sent1099: number;
  /** Effective needs-1099 count (override else >= $600 paid). */
  needs1099: number;
  totalPaidAll: number;
}

export async function getW9Summary(year: number): Promise<W9Summary> {
  const rows = await db.select().from(w9Recipients).where(eq(w9Recipients.year, year));
  return {
    year,
    total: rows.length,
    pendingW9: rows.filter((r) => r.status === "pending_w9").length,
    w9Received: rows.filter((r) => r.status === "w9_received").length,
    sent1099: rows.filter((r) => r.status === "1099_sent").length,
    needs1099: rows.filter((r) => effectiveNeeds1099(r)).length,
    totalPaidAll: rows.reduce((sum, r) => sum + totalPaidOf(r), 0),
  };
}

function csvCell(value: string | null | undefined): string {
  const v = value ?? "";
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * §18 - the state-specific export: recipients in Oregon needing a 1099 with
 * at least $600 paid. Both the effective needs_1099 flag AND the threshold
 * must hold.
 */
export async function exportOregonCsv(year: number): Promise<string> {
  const rows = await db
    .select()
    .from(w9Recipients)
    .where(
      and(
        eq(w9Recipients.year, year),
        sql`upper(trim(${w9Recipients.state})) = 'OR'`,
        sql`${w9Recipients.totalPaid}::numeric >= ${W9_1099_THRESHOLD}`,
      ),
    )
    .orderBy(asc(w9Recipients.vendorName));

  const eligible = rows.filter((r) => effectiveNeeds1099(r));
  const header = "vendor_name,email,address_line1,address_line2,city,state,zip,tax_id,total_paid,payment_type";
  const lines = eligible.map((r) =>
    [r.vendorName, r.email, r.addressLine1, r.addressLine2, r.city, r.state, r.zip, r.taxId, r.totalPaid, r.paymentType]
      .map(csvCell)
      .join(","),
  );
  return [header, ...lines].join("\n");
}

// ── W-9 request email (§18: on demand, no automated reminders) ────────────

/**
 * Emails the W-9 request to a manually supplied address and stamps
 * w9_requested_at. Goes through the sendEmail driver interface - the dev
 * driver logs and stashes (see src/server/email.ts).
 */
export async function emailW9Request(
  recipientId: number,
  emailAddress: string,
  userId: number,
): Promise<W9RecipientRow> {
  const row = await requireRecipient(recipientId);
  const to = emailAddress.trim().toLowerCase();
  if (to === "" || !to.includes("@")) throw new W9Error(400, "A valid email address is required");

  const [client] = await db.select().from(clients).where(eq(clients.id, row.clientId)).limit(1);
  const clientLabel = client ? (client.dbaName ?? client.legalName) : `Client ${row.clientId}`;

  await sendEmail({
    to,
    subject: `W-9 request from ${clientLabel}`,
    html: [
      `<p>Hello ${row.vendorName},</p>`,
      `<p>${clientLabel} needs a completed Form W-9 from you for ${row.year} tax reporting.</p>`,
      "<p>Please reply to this email with the signed form attached.</p>",
    ].join(""),
  });

  const [updated] = await db
    .update(w9Recipients)
    .set({ w9RequestedAt: new Date(), updatedAt: new Date() })
    .where(eq(w9Recipients.id, recipientId))
    .returning();
  await logEvent({
    userId,
    action: "w9_request_emailed",
    entityType: "w9_recipient",
    entityId: recipientId,
    metadata: { to, clientId: row.clientId, year: row.year },
  });
  return updated;
}
