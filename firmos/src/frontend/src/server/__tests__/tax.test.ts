import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { clients, documents, notifications, users, w9Recipients, yearEndTaxTemplates } from "@/db/schema";
import { toSessionUser, type SessionUser } from "@/server/auth/guards";
import { __clearEmailStashForTests, getLastEmailFor } from "@/server/email";
import { seedDatabase } from "@/server/seed";
import { __resetStorageForTests } from "@/server/storage";
import {
  addCpaChecklistNote,
  addCustomItem,
  ensureYearEndTemplates,
  getOrCreateClientChecklist,
  getTaxHub,
  populateAllChecklists,
  resetYearEndTemplates,
  setChecklistItemComplete,
  YEAR_END_DEFAULT_ITEMS,
} from "@/server/tax";
import {
  createW9Recipient,
  effectiveNeeds1099,
  emailW9Request,
  exportOregonCsv,
  getW9Summary,
  mark1099Sent,
  markW9Received,
  updateW9Recipient,
  uploadW9Document,
} from "@/server/w9";

import { dbReachable, TEST_TODAY } from "./helpers";

const reachable = await dbReachable();

// Tiny real PDF: the upload layer checks magic bytes against the extension.
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7

const TAX_YEAR = TEST_TODAY.year;
let docsRootTmp = "";

let carlos: SessionUser; // CPA for Harborline + Copperline, not Blue Spruce
let danaId: number;
let jorgeId: number;
let sofiaId: number;
let harborlineId: number;
let blueSpruceId: number;

async function sessionUserByEmail(email: string): Promise<SessionUser> {
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!row) throw new Error(`seeded user not found: ${email}`);
  return toSessionUser(row);
}

async function userIdByEmail(email: string): Promise<number> {
  return (await sessionUserByEmail(email)).id;
}

async function clientIdByName(legalName: string): Promise<number> {
  const [row] = await db.select({ id: clients.id }).from(clients).where(eq(clients.legalName, legalName)).limit(1);
  if (!row) throw new Error(`seeded client not found: ${legalName}`);
  return row.id;
}

describe.skipIf(!reachable)("tax + W-9 engines (HANDOFF §18)", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    savedEnv.FIRMOS_PORTAL_ENABLED = process.env.FIRMOS_PORTAL_ENABLED;
    savedEnv.FIRMOS_DOCS_ROOT = process.env.FIRMOS_DOCS_ROOT;
    process.env.FIRMOS_PORTAL_ENABLED = "1";
    docsRootTmp = mkdtempSync(path.join(tmpdir(), "firmos-tax-test-"));
    process.env.FIRMOS_DOCS_ROOT = docsRootTmp;
    __resetStorageForTests();
    __clearEmailStashForTests();

    await seedDatabase(TEST_TODAY);

    carlos = await sessionUserByEmail("carlos@riverstonetax.com");
    danaId = await userIdByEmail("dana@blueledgerbooks.com");
    jorgeId = await userIdByEmail("jorge@blueledgerbooks.com");
    sofiaId = await userIdByEmail("sofia@blueledgerbooks.com");
    harborlineId = await clientIdByName("Harborline Marine Supply");
    blueSpruceId = await clientIdByName("Blue Spruce Landscaping");
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    __resetStorageForTests();
    if (docsRootTmp) rmSync(docsRootTmp, { recursive: true, force: true });
  });

  // ── Year-end templates + checklists (§18) ──

  it("seeds the twelve default template items on first access, idempotently", async () => {
    const first = await ensureYearEndTemplates();
    expect(first.length).toBe(12);
    expect(first.map((t) => t.title)).toEqual(YEAR_END_DEFAULT_ITEMS.map((i) => i.title));

    const second = await ensureYearEndTemplates();
    expect(second.map((t) => t.id)).toEqual(first.map((t) => t.id));

    const count = await db.select().from(yearEndTaxTemplates);
    expect(count.length).toBe(12);
  });

  it("auto-populates a client checklist with role-derived assignees, idempotently", async () => {
    const items = await getOrCreateClientChecklist(harborlineId, TAX_YEAR);
    expect(items.length).toBe(12);

    // Harborline: manager Dana, bookkeeper Jorge.
    const byTitle = new Map(items.map((i) => [i.title, i]));
    for (const def of YEAR_END_DEFAULT_ITEMS) {
      const expected = def.defaultAssigneeRole === "manager" ? danaId : jorgeId;
      expect(byTitle.get(def.title)?.assigneeId, def.title).toBe(expected);
    }

    // Second call creates nothing new (partial unique index per template).
    const again = await getOrCreateClientChecklist(harborlineId, TAX_YEAR);
    expect(again.map((i) => i.id)).toEqual(items.map((i) => i.id));
  });

  it("managers can add custom items (template_id null)", async () => {
    const custom = await addCustomItem(harborlineId, TAX_YEAR, "Confirm new warehouse lease accounting", danaId, sofiaId);
    expect(custom.templateId).toBeNull();
    expect(custom.assigneeId).toBe(sofiaId);

    const items = await getOrCreateClientChecklist(harborlineId, TAX_YEAR);
    expect(items.length).toBe(13);
  });

  it("populateAllChecklists covers every active client once (the December workflow)", async () => {
    const result = await populateAllChecklists(TAX_YEAR);
    const activeClients = await db.select().from(clients).where(eq(clients.isActive, true));
    expect(result.clientsProcessed).toBe(activeClients.length);
    // Harborline already had 12 template items; every other client got 12.
    expect(result.itemsCreated).toBe((activeClients.length - 1) * 12);

    // Idempotent second run.
    const second = await populateAllChecklists(TAX_YEAR);
    expect(second.itemsCreated).toBe(0);
  });

  it("tax hub aggregates firm-wide completion", async () => {
    const items = await getOrCreateClientChecklist(harborlineId, TAX_YEAR);
    await setChecklistItemComplete(items[0].id, jorgeId, true);
    await setChecklistItemComplete(items[1].id, jorgeId, true);

    const hub = await getTaxHub(TAX_YEAR);
    const harborline = hub.clients.find((c) => c.clientId === harborlineId);
    expect(harborline).toBeDefined();
    expect(harborline!.total).toBe(13); // 12 defaults + 1 custom
    expect(harborline!.completed).toBe(2);
    expect(hub.totals.completed).toBeGreaterThanOrEqual(2);
    expect(hub.totals.items).toBeGreaterThanOrEqual(13);

    // Reopening clears the completion stamps.
    const reopened = await setChecklistItemComplete(items[0].id, jorgeId, false);
    expect(reopened.isCompleted).toBe(false);
    expect(reopened.completedAt).toBeNull();
    expect(reopened.completedById).toBeNull();
  });

  it("CPA notes validate the linked client set (IDOR) and notify the bookkeeper + manager", async () => {
    const items = await getOrCreateClientChecklist(harborlineId, TAX_YEAR);
    const target = items[0];

    // Carlos is not linked to Blue Spruce: rejected before the item is read.
    const blueItems = await getOrCreateClientChecklist(blueSpruceId, TAX_YEAR);
    await expect(
      addCpaChecklistNote(carlos, blueSpruceId, TAX_YEAR, blueItems[0].id, "snooping"),
    ).rejects.toMatchObject({ name: "PortalAccessDeniedError", status: 403 });

    // A Harborline item under the wrong client id is a 404, not a leak.
    await expect(
      addCpaChecklistNote(carlos, harborlineId, TAX_YEAR, blueItems[0].id, "wrong client"),
    ).rejects.toMatchObject({ status: 404 });

    const updated = await addCpaChecklistNote(carlos, harborlineId, TAX_YEAR, target.id, "Please confirm the Q4 payroll accrual.");
    expect(updated.cpaNotes).toBe("Please confirm the Q4 payroll accrual.");

    // Notes append.
    const appended = await addCpaChecklistNote(carlos, harborlineId, TAX_YEAR, target.id, "Also the December adjustment.");
    expect(appended.cpaNotes).toContain("Q4 payroll accrual");
    expect(appended.cpaNotes).toContain("December adjustment");

    const jorgeNotices = await db
      .select({ notificationType: notifications.notificationType })
      .from(notifications)
      .where(eq(notifications.userId, jorgeId));
    expect(jorgeNotices.some((n) => n.notificationType === "portal_cpa_yearend_note")).toBe(true);
    const danaNotices = await db
      .select({ notificationType: notifications.notificationType })
      .from(notifications)
      .where(eq(notifications.userId, danaId));
    expect(danaNotices.some((n) => n.notificationType === "portal_cpa_yearend_note")).toBe(true);
  });

  it("resetYearEndTemplates restores the twelve defaults", async () => {
    await resetYearEndTemplates(danaId);
    const rows = await db.select().from(yearEndTaxTemplates);
    expect(rows.length).toBe(12);
    expect(rows.map((r) => r.title).sort()).toEqual(YEAR_END_DEFAULT_ITEMS.map((i) => i.title).sort());
  });

  // ── W-9 / 1099 (§18) ──

  it("runs the status flow pending_w9 -> w9_received -> 1099_sent with guards", async () => {
    const vendor = await createW9Recipient(jorgeId, {
      clientId: harborlineId,
      vendorName: "Acme Dock Repair",
      year: TAX_YEAR,
      totalPaid: 2400,
      state: "OR",
    });
    expect(vendor.status).toBe("pending_w9");
    expect(vendor.needs1099).toBe(true); // >= $600 derived

    // Out of order: cannot send the 1099 before the W-9 is in.
    await expect(mark1099Sent(vendor.id, jorgeId)).rejects.toMatchObject({ status: 409 });

    const received = await markW9Received(vendor.id, jorgeId, "2026-08-10");
    expect(received.status).toBe("w9_received");
    expect(received.w9ReceivedDate).toBe("2026-08-10");

    // No double receipt.
    await expect(markW9Received(vendor.id, jorgeId)).rejects.toMatchObject({ status: 409 });

    const sent = await mark1099Sent(vendor.id, jorgeId, "2026-08-12");
    expect(sent.status).toBe("1099_sent");
    expect(sent.form1099SentDate).toBe("2026-08-12");
  });

  it("uploadW9Document creates a linked doc_type='w9' document and implies receipt", async () => {
    const vendor = await createW9Recipient(jorgeId, {
      clientId: harborlineId,
      vendorName: "Harbor Canvas Works",
      year: TAX_YEAR,
      totalPaid: 950,
      state: "OR",
    });

    const { recipient, documentId } = await uploadW9Document(
      vendor.id,
      { fileName: "w9-canvas.pdf", bytes: PDF_BYTES, mimeType: "application/pdf" },
      jorgeId,
      TEST_TODAY,
    );
    expect(recipient.w9DocumentId).toBe(documentId);
    expect(recipient.status).toBe("w9_received");

    const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
    expect(doc.docType).toBe("w9");
    expect(doc.clientId).toBe(harborlineId);
  });

  it("summary counts apply the $600 threshold with the manual override", async () => {
    await createW9Recipient(jorgeId, { clientId: harborlineId, vendorName: "Under Threshold LLC", year: TAX_YEAR, totalPaid: 599.99 });
    const overridden = await createW9Recipient(jorgeId, {
      clientId: harborlineId,
      vendorName: "Override Vendor",
      year: TAX_YEAR,
      totalPaid: 120,
      needs1099ManualOverride: true,
    });
    expect(effectiveNeeds1099(overridden)).toBe(true);

    // Clearing the override falls back to the threshold-derived flag.
    const cleared = await updateW9Recipient(jorgeId, overridden.id, { needs1099ManualOverride: null });
    expect(cleared.needs1099).toBe(false);

    const summary = await getW9Summary(TAX_YEAR);
    // Created so far: Acme (1099_sent), Harbor Canvas (w9_received),
    // Under Threshold (pending, no 1099), Override (pending, override cleared).
    expect(summary.total).toBe(4);
    expect(summary.sent1099).toBe(1);
    expect(summary.w9Received).toBe(1);
    expect(summary.pendingW9).toBe(2);
    expect(summary.needs1099).toBe(2); // Acme + Harbor Canvas
  });

  it("Oregon CSV export filters to OR recipients needing a 1099 with >= $600 paid", async () => {
    await createW9Recipient(jorgeId, { clientId: harborlineId, vendorName: "California Vendor", year: TAX_YEAR, totalPaid: 5000, state: "CA" });
    await createW9Recipient(jorgeId, { clientId: harborlineId, vendorName: "Oregon Small", year: TAX_YEAR, totalPaid: 400, state: "OR" });
    await createW9Recipient(jorgeId, { clientId: harborlineId, vendorName: "Oregon No Override Off", year: TAX_YEAR, totalPaid: 900, state: "OR", needs1099ManualOverride: false });

    const csv = await exportOregonCsv(TAX_YEAR);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("vendor_name,email,address_line1,address_line2,city,state,zip,tax_id,total_paid,payment_type");

    const body = lines.slice(1).join("\n");
    // In: Acme Dock Repair (2400, OR), Harbor Canvas Works (950, OR).
    expect(body).toContain("Acme Dock Repair");
    expect(body).toContain("Harbor Canvas Works");
    // Out: wrong state, under threshold, manual override off.
    expect(body).not.toContain("California Vendor");
    expect(body).not.toContain("Oregon Small");
    expect(body).not.toContain("Oregon No Override Off");
  });

  it("emailW9Request sends through the dev driver and stamps w9_requested_at", async () => {
    const vendor = await createW9Recipient(jorgeId, {
      clientId: harborlineId,
      vendorName: "Email Me Vendor",
      year: TAX_YEAR,
      totalPaid: 800,
    });

    const updated = await emailW9Request(vendor.id, "Billing@EmailMeVendor.com", jorgeId);
    expect(updated.w9RequestedAt).not.toBeNull();

    const message = getLastEmailFor("billing@emailmevendor.com");
    expect(message).not.toBeNull();
    expect(message!.subject).toContain("W-9");
    expect(message!.html).toContain("Email Me Vendor");

    await expect(emailW9Request(vendor.id, "not-an-email", jorgeId)).rejects.toMatchObject({ status: 400 });
  });
});
