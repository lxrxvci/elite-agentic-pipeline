import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, type LocalDate } from "@firmos/domain";

import { db } from "@/db";
import { accounts, clients, documents, users } from "@/db/schema";
import { AuthError, toSessionUser, type SessionUser } from "@/server/auth/guards";
import { localToday } from "@/server/dates";
import {
  DocumentError,
  clientSlug,
  deleteDocument,
  documentGroupOf,
  getDocumentTree,
  mmddyy,
  promoteToStatement,
  statementRelPath,
  uploadDocument,
  uploadStatement,
} from "@/server/documents";
import { seedDatabase } from "@/server/seed";
import { __resetStorageForTests, absDocPath, docsRoot, getStorageDriver } from "@/server/storage";
import { UploadValidationError, validateUpload } from "@/server/uploads";

import { TEST_TODAY, dbReachable } from "./helpers";

const reachable = await dbReachable();

// Tiny real files: the magic-byte layer checks content against extension.
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MZ_BYTES = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
const TEXT_BYTES = new TextEncoder().encode("date,amount\n2026-01-01,10.00\n");

let docsRootTmp = "";

async function userByEmail(email: string): Promise<SessionUser> {
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!row) throw new Error(`seeded user not found: ${email}`);
  return toSessionUser(row);
}

async function clientByName(legalName: string) {
  const [row] = await db.select().from(clients).where(eq(clients.legalName, legalName)).limit(1);
  if (!row) throw new Error(`seeded client not found: ${legalName}`);
  return row;
}

async function accountByName(clientId: number, name: string) {
  const rows = await db.select().from(accounts).where(eq(accounts.clientId, clientId));
  const row = rows.find((a) => a.name === name);
  if (!row) throw new Error(`seeded account not found: ${name}`);
  return row;
}

// ── Pure validation layers (§13) - no DB needed ───────────────────────────

describe("validateUpload (§13 layered validation)", () => {
  it("accepts a well-formed pdf and normalizes the inputs", () => {
    const v = validateUpload("JULY statement.PDF", "application/pdf", PDF_BYTES);
    expect(v.ext).toBe("pdf");
    expect(v.mimeType).toBe("application/pdf");
  });

  it("rejects a disallowed extension", () => {
    expect(() => validateUpload("evil.exe", "application/octet-stream", TEXT_BYTES)).toThrow(
      UploadValidationError,
    );
    expect(() => validateUpload("evil.exe", "application/octet-stream", TEXT_BYTES)).toThrow(
      /cannot be uploaded/i,
    );
  });

  it("rejects a disallowed declared MIME type", () => {
    expect(() => validateUpload("notes.txt", "application/x-msdownload", TEXT_BYTES)).toThrow(
      UploadValidationError,
    );
  });

  it("rejects content that does not match its extension (magic bytes)", () => {
    expect(() => validateUpload("statement.pdf", "application/pdf", TEXT_BYTES)).toThrow(
      /do not match/i,
    );
  });

  it("denies executable signatures regardless of extension", () => {
    expect(() => validateUpload("payload.txt", "text/plain", MZ_BYTES)).toThrow(
      /Windows executable/i,
    );
    const shebang = new TextEncoder().encode("#!/bin/sh\nrm -rf /\n");
    expect(() => validateUpload("script.txt", "text/plain", shebang)).toThrow(/shell script/i);
    const elf = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]);
    expect(() => validateUpload("elf.csv", "text/csv", elf)).toThrow(/ELF executable/i);
  });

  it("enforces the 50 MB cap", () => {
    const oversize = new Uint8Array(50 * 1024 * 1024 + 1);
    expect(() => validateUpload("big.zip", "application/zip", oversize)).toThrow(/50 MB/);
  });

  it("strips path segments and control characters from file names", () => {
    const v = validateUpload("../../etc/statement.pdf", "application/pdf", PDF_BYTES);
    expect(v.fileName).toBe("statement.pdf");
  });
});

// ── Path layout + traversal guard (§13) ───────────────────────────────────

describe("storage paths (§13)", () => {
  it("builds the deterministic statement path", () => {
    const rel = statementRelPath(
      { dbaName: null, legalName: "Harborline Marine Supply" },
      "Operating Checking",
      { year: 2026, month: 7 },
      { year: 2026, month: 7, day: 31 },
      "pdf",
    );
    expect(rel).toBe(
      "harborline-marine-supply/Documents/Statements/operating-checking/2026/073126.pdf",
    );
  });

  it("formats MMDDYY stems and slugs", () => {
    expect(mmddyy({ year: 2026, month: 1, day: 5 })).toBe("010526");
    expect(clientSlug({ dbaName: "Fern & Feather", legalName: "Fern & Feather Floral Studio" })).toBe(
      "fern-feather",
    );
  });

  it("rejects '..' and escapes in absDocPath (HANDOFF traversal guard)", () => {
    const root = "/tmp/firmos-docs-test";
    expect(() => absDocPath("../outside.pdf", root)).toThrow(/\.\./);
    expect(() => absDocPath("client/../../outside.pdf", root)).toThrow(/\.\./);
    expect(() => absDocPath("", root)).toThrow();
    const ok = absDocPath("client/Documents/Statements/a/2026/073126.pdf", root);
    expect(ok.startsWith(path.resolve(root))).toBe(true);
  });
});

// ── DB-backed upload / promote / delete flows ─────────────────────────────

describe.skipIf(!reachable)("documents engine (DB-backed)", () => {
  beforeAll(async () => {
    docsRootTmp = mkdtempSync(path.join(tmpdir(), "firmos-docs-"));
    process.env.FIRMOS_DOCS_ROOT = docsRootTmp;
    __resetStorageForTests();
    await seedDatabase(TEST_TODAY);
  });

  afterAll(() => {
    if (docsRootTmp) rmSync(docsRootTmp, { recursive: true, force: true });
    delete process.env.FIRMOS_DOCS_ROOT;
    __resetStorageForTests();
  });

  it("general upload validates, stores bytes at the deterministic path, and inserts a row", async () => {
    const harborline = await clientByName("Harborline Marine Supply");
    const mara = await userByEmail("mara@blueledgerbooks.com");

    const doc = await uploadDocument({
      clientId: harborline.id,
      uploadedById: mara.id,
      fileName: "bank-letter.pdf",
      mimeType: "application/pdf",
      bytes: PDF_BYTES,
      folder: "Tax",
      docType: "tax",
      today: TEST_TODAY,
    });

    expect(doc.storedPath).toBe(
      `harborline-marine-supply/Documents/Tax/${mmddyy(TEST_TODAY)}.pdf`,
    );
    const driver = await getStorageDriver();
    const stored = await driver.get(doc.storedPath);
    expect(Buffer.from(stored).equals(Buffer.from(PDF_BYTES))).toBe(true);
    expect(docsRoot()).toBe(docsRootTmp);

    // §13: general uploads always insert a NEW row (suffixed path on collision).
    const again = await uploadDocument({
      clientId: harborline.id,
      uploadedById: mara.id,
      fileName: "bank-letter.pdf",
      mimeType: "application/pdf",
      bytes: PDF_BYTES,
      folder: "Tax",
      docType: "tax",
      today: TEST_TODAY,
    });
    expect(again.id).not.toBe(doc.id);
    expect(again.storedPath).toBe(
      `harborline-marine-supply/Documents/Tax/${mmddyy(TEST_TODAY)}-2.pdf`,
    );
  });

  it("refuses general uploads into the protected Statements folder", async () => {
    const harborline = await clientByName("Harborline Marine Supply");
    const mara = await userByEmail("mara@blueledgerbooks.com");
    await expect(
      uploadDocument({
        clientId: harborline.id,
        uploadedById: mara.id,
        fileName: "x.pdf",
        mimeType: "application/pdf",
        bytes: PDF_BYTES,
        folder: "Statements",
        today: TEST_TODAY,
      }),
    ).rejects.toThrow(DocumentError);
  });

  it("statement upload: month-end attribution round-trips onto the deterministic path", async () => {
    const harborline = await clientByName("Harborline Marine Supply");
    const checking = await accountByName(harborline.id, "Operating Checking");
    const mara = await userByEmail("mara@blueledgerbooks.com");

    const result = await uploadStatement({
      accountId: checking.id,
      uploadedById: mara.id,
      fileName: "july-statement.pdf",
      mimeType: "application/pdf",
      bytes: PDF_BYTES,
      statementDate: "2026-07-31",
      today: TEST_TODAY,
    });

    expect(result.period).toEqual({ year: 2026, month: 7 });
    expect(result.storedPath).toBe(
      "harborline-marine-supply/Documents/Statements/operating-checking/2026/073126.pdf",
    );
    expect(result.document.docType).toBe("statement");
    expect(result.document.statementDate).toBe("2026-07-31");
    expect(result.document.attributedYear).toBe(2026);
    expect(result.document.attributedMonth).toBe(7);
    expect(result.updatedInPlace).toBe(false);

    const [acct] = await db.select().from(accounts).where(eq(accounts.id, checking.id));
    expect(acct.lastStatementDate).toBe("2026-07-31");
  });

  it("mid-month statement day: date after the tier cutoff keeps its own month", async () => {
    const harborline = await clientByName("Harborline Marine Supply");
    const card = await accountByName(harborline.id, "Business Credit Card"); // day 20, tier 5
    const mara = await userByEmail("mara@blueledgerbooks.com");

    const result = await uploadStatement({
      accountId: card.id,
      uploadedById: mara.id,
      fileName: "card-july.pdf",
      mimeType: "application/pdf",
      bytes: PDF_BYTES,
      statementDate: "2026-07-20",
      today: TEST_TODAY,
    });
    // §6.1 worked example: statement_day 20 on/after the cutoff covers its own month.
    expect(result.period).toEqual({ year: 2026, month: 7 });
    expect(result.storedPath).toContain("/2026/072026.pdf");
  });

  it("mid-month statement day before the cutoff covers the prior month", async () => {
    const harborline = await clientByName("Harborline Marine Supply");
    const payroll = await accountByName(harborline.id, "Payroll Checking"); // day 3, tier 5
    const mara = await userByEmail("mara@blueledgerbooks.com");

    const result = await uploadStatement({
      accountId: payroll.id,
      uploadedById: mara.id,
      fileName: "payroll-aug.pdf",
      mimeType: "application/pdf",
      bytes: PDF_BYTES,
      statementDate: "2026-08-03",
      today: TEST_TODAY,
    });
    // §6.1: day 3 < cutoff 5, so the Aug 3 statement is July's.
    expect(result.period).toEqual({ year: 2026, month: 7 });
    expect(result.storedPath).toContain("/2026/080326.pdf");
  });

  it("§29: an explicit period is honored only for month-end statement dates", async () => {
    const harborline = await clientByName("Harborline Marine Supply");
    const checking = await accountByName(harborline.id, "Operating Checking"); // day 31
    const card = await accountByName(harborline.id, "Business Credit Card"); // day 20
    const mara = await userByEmail("mara@blueledgerbooks.com");

    // Month-end date: the clicked grid cell's period wins (ambiguous case).
    const monthEnd = await uploadStatement({
      accountId: checking.id,
      uploadedById: mara.id,
      fileName: "backfill.pdf",
      mimeType: "application/pdf",
      bytes: PDF_BYTES,
      statementDate: "2026-05-31",
      explicitYear: 2026,
      explicitMonth: 4,
      today: TEST_TODAY,
    });
    expect(monthEnd.period).toEqual({ year: 2026, month: 4 });
    expect(monthEnd.storedPath).toContain("/2026/053126.pdf");

    // Non-month-end date: the explicit period is DISCARDED (§29 fix) and the
    // derived period wins - the user cannot misfile relative to the cell.
    const midMonth = await uploadStatement({
      accountId: card.id,
      uploadedById: mara.id,
      fileName: "clicked-june-cell.pdf",
      mimeType: "application/pdf",
      bytes: PDF_BYTES,
      statementDate: "2026-07-20",
      explicitYear: 2026,
      explicitMonth: 6,
      today: TEST_TODAY,
    });
    expect(midMonth.period).toEqual({ year: 2026, month: 7 });
  });

  it("statement re-upload updates the existing row in place", async () => {
    const harborline = await clientByName("Harborline Marine Supply");
    const checking = await accountByName(harborline.id, "Operating Checking");
    const mara = await userByEmail("mara@blueledgerbooks.com");

    const before = await db.select().from(documents);
    const reupload = await uploadStatement({
      accountId: checking.id,
      uploadedById: mara.id,
      fileName: "july-statement-v2.pdf",
      mimeType: "application/pdf",
      bytes: new Uint8Array([...PDF_BYTES, 0x0a]),
      statementDate: "2026-07-31",
      today: TEST_TODAY,
    });
    const after = await db.select().from(documents);

    expect(reupload.updatedInPlace).toBe(true);
    expect(after).toHaveLength(before.length); // no new row
    expect(reupload.document.fileName).toBe("july-statement-v2.pdf");
    expect(reupload.document.sizeBytes).toBe(PDF_BYTES.length + 1);
    const driver = await getStorageDriver();
    const stored = await driver.get(reupload.storedPath);
    expect(stored.length).toBe(PDF_BYTES.length + 1);
  });

  it("promote-to-statement moves the file into the statement tree (happy path)", async () => {
    const harborline = await clientByName("Harborline Marine Supply");
    const checking = await accountByName(harborline.id, "Operating Checking");
    const mara = await userByEmail("mara@blueledgerbooks.com");

    const general = await uploadDocument({
      clientId: harborline.id,
      uploadedById: mara.id,
      fileName: "scanned-statement.pdf",
      mimeType: "application/pdf",
      bytes: PDF_BYTES,
      folder: "General",
      today: TEST_TODAY,
    });
    const oldPath = general.storedPath;

    const promoted = await promoteToStatement(general.id, checking.id, "2026-06-30");
    expect(promoted.period).toEqual({ year: 2026, month: 6 });
    expect(promoted.document.docType).toBe("statement");
    expect(promoted.document.fileName).toBe("063026.pdf");
    expect(promoted.storedPath).toBe(
      "harborline-marine-supply/Documents/Statements/operating-checking/2026/063026.pdf",
    );

    const driver = await getStorageDriver();
    const moved = await driver.get(promoted.storedPath);
    expect(Buffer.from(moved).equals(Buffer.from(PDF_BYTES))).toBe(true);
    // §13: the old file is unlinked once no row references it.
    await expect(driver.get(oldPath)).rejects.toThrow();
  });

  it("promote-to-statement rejects an account from a different client", async () => {
    const harborline = await clientByName("Harborline Marine Supply");
    const blueSpruce = await clientByName("Blue Spruce Landscaping");
    const wrongAccount = await accountByName(blueSpruce.id, "Main Checking");
    const mara = await userByEmail("mara@blueledgerbooks.com");

    const general = await uploadDocument({
      clientId: harborline.id,
      uploadedById: mara.id,
      fileName: "receipt-scan.pdf",
      mimeType: "application/pdf",
      bytes: PDF_BYTES,
      folder: "General",
      today: TEST_TODAY,
    });

    await expect(promoteToStatement(general.id, wrongAccount.id, "2026-06-30")).rejects.toThrow(
      /different client/i,
    );
  });

  it("folder tree groups documents by doc_type and seeds protected folders", async () => {
    const harborline = await clientByName("Harborline Marine Supply");
    const tree = await getDocumentTree(harborline.id);

    const topNames = tree.folders.map((f) => f.name);
    expect(topNames).toContain("Statements");
    expect(topNames).toContain("Reports");
    expect(tree.folders.find((f) => f.name === "Statements")?.isProtected).toBe(true);

    expect(tree.documentsByGroup.statements.length).toBeGreaterThan(0);
    expect(tree.documentsByGroup.tax.length).toBeGreaterThan(0);
    expect(documentGroupOf("w9")).toBe("tax");
    expect(documentGroupOf("receipt")).toBe("receipts");
  });

  it("delete permission matrix (§13)", async () => {
    const harborline = await clientByName("Harborline Marine Supply");
    const mara = await userByEmail("mara@blueledgerbooks.com"); // owner
    const dana = await userByEmail("dana@blueledgerbooks.com"); // manager
    const jorge = await userByEmail("jorge@blueledgerbooks.com"); // bookkeeper
    const sofia = await userByEmail("sofia@blueledgerbooks.com"); // bookkeeper

    const uploadAs = (userId: number) =>
      uploadDocument({
        clientId: harborline.id,
        uploadedById: userId,
        fileName: "matrix.pdf",
        mimeType: "application/pdf",
        bytes: PDF_BYTES,
        folder: "General",
        today: TEST_TODAY,
      });

    const realToday = localToday();
    const otherDay: LocalDate = addDays(realToday, 2);

    // Staff, not the uploader, on a different day: denied.
    const jorgeDoc = await uploadAs(jorge.id);
    await expect(deleteDocument(jorgeDoc.id, dana, otherDay)).rejects.toThrow(AuthError);
    // Staff same day as the upload: allowed.
    const danaDoc = await uploadAs(dana.id);
    await expect(deleteDocument(danaDoc.id, sofia, realToday)).resolves.toBeUndefined();
    // The original uploader: allowed on any day.
    await expect(deleteDocument(jorgeDoc.id, jorge, otherDay)).resolves.toBeUndefined();
    // Admin/owner: always allowed.
    const maraDoc = await uploadAs(mara.id);
    await expect(deleteDocument(maraDoc.id, mara, otherDay)).resolves.toBeUndefined();
  });

  it("statement deletion requires the statements flag for non-admin staff", async () => {
    const harborline = await clientByName("Harborline Marine Supply");
    const checking = await accountByName(harborline.id, "Operating Checking");
    const mara = await userByEmail("mara@blueledgerbooks.com");
    const dana = await userByEmail("dana@blueledgerbooks.com");

    const stmt = await uploadStatement({
      accountId: checking.id,
      uploadedById: mara.id,
      fileName: "may.pdf",
      mimeType: "application/pdf",
      bytes: PDF_BYTES,
      statementDate: "2026-05-29",
      today: TEST_TODAY,
    });

    const otherDay: LocalDate = addDays(localToday(), 2);
    // Manager without the flag, not the uploader, not same day: denied.
    await expect(deleteDocument(stmt.document.id, dana, otherDay)).rejects.toThrow(AuthError);

    // Grant the delegated flag (§11) and the same manager may delete it.
    await db.update(users).set({ canAccessStatements: true }).where(eq(users.id, dana.id));
    const danaWithFlag = await userByEmail("dana@blueledgerbooks.com");
    await expect(
      deleteDocument(stmt.document.id, danaWithFlag, otherDay),
    ).resolves.toBeUndefined();
  });

  it("the traversal guard rejects '..' through the storage driver", async () => {
    const driver = await getStorageDriver();
    await expect(driver.get("../secret.pdf")).rejects.toThrow(/\.\./);
    await expect(driver.put("a/../../b.pdf", PDF_BYTES)).rejects.toThrow(/\.\./);
    await expect(driver.delete("..")).rejects.toThrow(/\.\./);
  });
});
