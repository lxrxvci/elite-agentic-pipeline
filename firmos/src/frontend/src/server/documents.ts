import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  attributedPeriodForDate,
  compareLocalDate,
  formatLocalDate,
  parseLocalDate,
  resolveAttributedPeriod,
  tierDayForClient,
  type LocalDate,
  type Month,
} from "@firmos/domain";

import { db } from "@/db";
import { accounts, clients, documentFolders, documents } from "@/db/schema";
import { AuthError, canAccessStatements, type SessionUser, type UserRole } from "@/server/auth/guards";
import { localToday } from "@/server/dates";
import { toDomainClient } from "@/server/domain-adapters";
import { visibleClientIds } from "@/server/queue";
import { getStorageDriver } from "@/server/storage";
import { validateUpload, type ValidatedUpload } from "@/server/uploads";

/**
 * The document hub (HANDOFF §7, §13). Owns the deterministic storage layout,
 * upload entry points (general + statement), promote-to-statement, the folder
 * tree read, download access, and deletion.
 *
 * Layout (§13):
 *   {clientSlug}/Documents/Statements/{accountName}/{year}/{MMDDYY}.{ext}
 *   {clientSlug}/Documents/{folder}/{MMDDYY}.{ext}
 *
 * Statement rules (§13, §30 conv. 4 and 8):
 *  - every statement upload path resolves its accounting month through the
 *    domain resolveAttributedPeriod - explicit periods are honored ONLY for
 *    the genuinely ambiguous month-end case (§29 fix);
 *  - statement re-uploads reuse the deterministic path and update the row in
 *    place; general uploads always insert a new row;
 *  - Statements and Reports are protected top-level folders.
 */

export class DocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentError";
  }
}

export type DocumentRow = typeof documents.$inferSelect;
export type AccountRow = typeof accounts.$inferSelect;
export type ClientRow = typeof clients.$inferSelect;

/** §13 - protected top-level folders: cannot be renamed, moved, or deleted. */
export const PROTECTED_FOLDERS = ["Statements", "Reports"] as const;

// ── Deterministic layout (§13) ────────────────────────────────────────────

/** Filesystem-safe slug for client and account names in storage paths. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  return slug === "" ? "unnamed" : slug;
}

export function clientSlug(client: Pick<ClientRow, "dbaName" | "legalName">): string {
  return slugify(client.dbaName ?? client.legalName);
}

/** MMDDYY file stem from a local date (§13 naming convention). */
export function mmddyy(d: LocalDate): string {
  const mm = String(d.month).padStart(2, "0");
  const dd = String(d.day).padStart(2, "0");
  const yy = String(d.year % 100).padStart(2, "0");
  return `${mm}${dd}${yy}`;
}

/** §13 statement tree: {client}/Documents/Statements/{account}/{year}/{MMDDYY}.{ext}. */
export function statementRelPath(
  client: Pick<ClientRow, "dbaName" | "legalName">,
  accountName: string,
  period: Month,
  statementDate: LocalDate,
  ext: string,
): string {
  return [
    clientSlug(client),
    "Documents",
    "Statements",
    slugify(accountName),
    String(period.year),
    `${mmddyy(statementDate)}.${ext}`,
  ].join("/");
}

/** §13 general tree: {client}/Documents/{folder}/{MMDDYY}.{ext}. */
export function generalRelPath(
  client: Pick<ClientRow, "dbaName" | "legalName">,
  folder: string,
  date: LocalDate,
  ext: string,
): string {
  return [clientSlug(client), "Documents", folder, `${mmddyy(date)}.${ext}`].join("/");
}

// ── Shared helpers ────────────────────────────────────────────────────────

async function requireClient(clientId: number): Promise<ClientRow> {
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) throw new DocumentError("That client no longer exists.");
  return client;
}

async function requireAccount(accountId: number): Promise<AccountRow> {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!account) throw new DocumentError("That account no longer exists.");
  return account;
}

export async function getDocumentById(documentId: number): Promise<DocumentRow | null> {
  const [row] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  return row ?? null;
}

/** §5/§6.1 - the client's close-tier day via the domain (never re-derived). */
function tierOf(client: ClientRow) {
  return tierDayForClient(toDomainClient(client));
}

/** Bump last_statement_date forward only (a backdated re-upload must not move it back). */
async function touchLastStatementDate(account: AccountRow, statementDate: string): Promise<void> {
  if (account.lastStatementDate && account.lastStatementDate >= statementDate) return;
  await db
    .update(accounts)
    .set({ lastStatementDate: statementDate })
    .where(eq(accounts.id, account.id));
}

// ── General upload (§13: always inserts a new row) ────────────────────────

export interface UploadDocumentInput {
  clientId: number;
  uploadedById: number;
  fileName: string;
  mimeType?: string | null;
  bytes: Uint8Array;
  /** Top-level folder under Documents/ (default "General"). */
  folder?: string | null;
  folderId?: number | null;
  docType?: string;
  today: LocalDate;
}

export async function uploadDocument(input: UploadDocumentInput): Promise<DocumentRow> {
  const validated = validateUpload(input.fileName, input.mimeType ?? null, input.bytes);
  const client = await requireClient(input.clientId);

  const folder = (input.folder ?? "General").trim() || "General";
  // §13 - Statements and Reports are protected; their contents are managed
  // by the statement flow and the report flow, never by general uploads.
  if (PROTECTED_FOLDERS.some((p) => p.toLowerCase() === folder.toLowerCase())) {
    throw new DocumentError(
      `"${folder}" is a protected folder - upload statements through the statement flow.`,
    );
  }

  const driver = await getStorageDriver();
  // Deterministic path; on a same-day same-name collision suffix the stem so
  // the new-row rule (§13) never fights the unique stored_path index.
  let relPath = generalRelPath(client, folder, input.today, validated.ext);
  for (let n = 2; await pathTaken(relPath); n++) {
    relPath = generalRelPath(client, folder, input.today, validated.ext).replace(
      /\.[^.]+$/,
      `-${n}.${validated.ext}`,
    );
  }

  await driver.put(relPath, validated.bytes);
  try {
    const [row] = await db
      .insert(documents)
      .values({
        clientId: client.id,
        folderId: input.folderId ?? null,
        uploadedById: input.uploadedById,
        fileName: validated.fileName,
        storedPath: relPath,
        mimeType: validated.mimeType || null,
        sizeBytes: validated.bytes.length,
        docType: input.docType ?? "general",
      })
      .returning();
    return row;
  } catch (err) {
    // Compensate: never leave an orphaned file behind a failed insert.
    await driver.delete(relPath).catch(() => undefined);
    throw err;
  }
}

async function pathTaken(relPath: string): Promise<boolean> {
  const [row] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.storedPath, relPath))
    .limit(1);
  return row != null;
}

// ── Statement upload (§13, §30 conv. 8) ───────────────────────────────────

export interface UploadStatementInput {
  accountId: number;
  uploadedById: number;
  fileName: string;
  mimeType?: string | null;
  bytes: Uint8Array;
  /** The date printed on the statement, YYYY-MM-DD. */
  statementDate: string;
  /** The grid cell the user clicked - honored only for month-end dates (§29). */
  explicitYear?: number | null;
  explicitMonth?: number | null;
  today: LocalDate;
}

export interface StatementUploadResult {
  document: DocumentRow;
  /** The accounting month the statement was attributed to (§6.1 RULE 1). */
  period: Month;
  storedPath: string;
  /** True when a re-upload updated the existing row at the deterministic path. */
  updatedInPlace: boolean;
}

/** Validation + attribution shared by uploadStatement and promoteToStatement. */
async function resolveStatementTarget(
  account: AccountRow,
  statementDateIso: string,
  explicitYear: number | null | undefined,
  explicitMonth: number | null | undefined,
): Promise<{ client: ClientRow; statementDate: LocalDate; period: Month }> {
  const client = await requireClient(account.clientId);
  let statementDate: LocalDate;
  try {
    statementDate = parseLocalDate(statementDateIso);
  } catch {
    throw new DocumentError("The statement date must be a valid date (YYYY-MM-DD).");
  }
  // §30 convention 8: every statement upload path resolves through the
  // domain. resolveAttributedPeriod discards the explicit period for any
  // non-month-end statement date (§29 fix).
  const period = resolveAttributedPeriod(
    account.statementDay,
    statementDate,
    tierOf(client),
    explicitYear ?? null,
    explicitMonth ?? null,
  );
  return { client, statementDate, period };
}

export async function uploadStatement(input: UploadStatementInput): Promise<StatementUploadResult> {
  const validated = validateUpload(input.fileName, input.mimeType ?? null, input.bytes);
  const account = await requireAccount(input.accountId);
  const { client, statementDate, period } = await resolveStatementTarget(
    account,
    input.statementDate,
    input.explicitYear,
    input.explicitMonth,
  );

  const relPath = statementRelPath(client, account.name, period, statementDate, validated.ext);
  const statementDateIso = formatLocalDate(statementDate);
  const driver = await getStorageDriver();

  // §13 versioning rule: statement re-uploads reuse the deterministic path
  // and update the existing row in place.
  const [existing] = await db
    .select()
    .from(documents)
    .where(eq(documents.storedPath, relPath))
    .limit(1);

  await driver.put(relPath, validated.bytes);
  try {
    let row: DocumentRow;
    if (existing) {
      [row] = await db
        .update(documents)
        .set({
          fileName: validated.fileName,
          mimeType: validated.mimeType || null,
          sizeBytes: validated.bytes.length,
          docType: "statement",
          accountId: account.id,
          statementDate: statementDateIso,
          attributedYear: period.year,
          attributedMonth: period.month,
          uploadedById: input.uploadedById,
        })
        .where(eq(documents.id, existing.id))
        .returning();
    } else {
      [row] = await db
        .insert(documents)
        .values({
          clientId: client.id,
          accountId: account.id,
          uploadedById: input.uploadedById,
          fileName: validated.fileName,
          storedPath: relPath,
          mimeType: validated.mimeType || null,
          sizeBytes: validated.bytes.length,
          docType: "statement",
          statementDate: statementDateIso,
          attributedYear: period.year,
          attributedMonth: period.month,
        })
        .returning();
    }
    await touchLastStatementDate(account, statementDateIso);
    return { document: row, period, storedPath: relPath, updatedInPlace: existing != null };
  } catch (err) {
    if (!existing) await driver.delete(relPath).catch(() => undefined);
    throw err;
  }
}

/**
 * §13 promote-to-statement: converts a generic document into a statement.
 * Validates the account (it must belong to the document's client), renames
 * the file to MMDDYY, moves it into the statement tree, sets statement_date
 * and the attributed period via resolveAttributedPeriod (§30 conv. 8), and
 * updates the account's last statement date.
 */
export async function promoteToStatement(
  documentId: number,
  accountId: number,
  statementDateIso: string,
  opts: { explicitYear?: number | null; explicitMonth?: number | null } = {},
): Promise<StatementUploadResult> {
  const document = await getDocumentById(documentId);
  if (!document) throw new DocumentError("That document no longer exists.");
  if (document.docType === "statement") {
    throw new DocumentError("That file is already a statement - re-upload it instead.");
  }
  if (document.clientId == null) {
    throw new DocumentError("Only client documents can be promoted to statements.");
  }

  const account = await requireAccount(accountId);
  if (account.clientId !== document.clientId) {
    throw new DocumentError("That account belongs to a different client.");
  }

  const { client, statementDate, period } = await resolveStatementTarget(
    account,
    statementDateIso,
    opts.explicitYear,
    opts.explicitMonth,
  );

  const ext = document.fileName.includes(".")
    ? document.fileName.slice(document.fileName.lastIndexOf(".") + 1).toLowerCase()
    : "pdf";
  const newPath = statementRelPath(client, account.name, period, statementDate, ext);
  if (await pathTaken(newPath)) {
    throw new DocumentError("A statement already exists for that account and month.");
  }

  const driver = await getStorageDriver();
  const bytes = await driver.get(document.storedPath);
  await driver.put(newPath, bytes);

  const newFileName = `${mmddyy(statementDate)}.${ext}`;
  const [row] = await db
    .update(documents)
    .set({
      accountId: account.id,
      docType: "statement",
      fileName: newFileName,
      storedPath: newPath,
      statementDate: formatLocalDate(statementDate),
      attributedYear: period.year,
      attributedMonth: period.month,
    })
    .where(eq(documents.id, document.id))
    .returning();

  // Unlink the old file only when no other row references it (§13).
  await unlinkIfUnreferenced(document.storedPath);
  await touchLastStatementDate(account, formatLocalDate(statementDate));
  return { document: row, period, storedPath: newPath, updatedInPlace: true };
}

// ── Folder tree read (§7/§13) ─────────────────────────────────────────────

/** doc_type → display group (§13 document grouping). */
export type DocumentGroup = "statements" | "reports" | "tax" | "receipts" | "general";

export function documentGroupOf(docType: string): DocumentGroup {
  switch (docType) {
    case "statement":
      return "statements";
    case "report":
      return "reports";
    case "tax":
    case "w9":
      return "tax";
    case "receipt":
      return "receipts";
    default:
      return "general";
  }
}

export interface DocumentFolderNode {
  /** null for the virtual protected top-level nodes. */
  id: number | null;
  name: string;
  isProtected: boolean;
  parentId: number | null;
  children: DocumentFolderNode[];
}

export interface DocumentTree {
  clientId: number;
  folders: DocumentFolderNode[];
  documentsByGroup: Record<DocumentGroup, DocumentRow[]>;
}

export async function getDocumentTree(clientId: number): Promise<DocumentTree> {
  const [folderRows, docRows] = await Promise.all([
    db
      .select()
      .from(documentFolders)
      .where(eq(documentFolders.clientId, clientId))
      .orderBy(asc(documentFolders.name)),
    db
      .select()
      .from(documents)
      .where(eq(documents.clientId, clientId))
      .orderBy(desc(documents.createdAt)),
  ]);

  // §13 - the two protected top-level folders always exist, even before any
  // folder row has been created for them.
  const topLevel: DocumentFolderNode[] = PROTECTED_FOLDERS.map((name) => ({
    id: null,
    name,
    isProtected: true,
    parentId: null,
    children: [],
  }));

  const nodes = new Map<number, DocumentFolderNode>();
  for (const f of folderRows) {
    nodes.set(f.id, {
      id: f.id,
      name: f.name,
      isProtected: f.isProtected,
      parentId: f.parentId,
      children: [],
    });
  }
  const roots: DocumentFolderNode[] = [...topLevel];
  for (const node of nodes.values()) {
    if (node.parentId != null && nodes.has(node.parentId)) {
      nodes.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const documentsByGroup: Record<DocumentGroup, DocumentRow[]> = {
    statements: [],
    reports: [],
    tax: [],
    receipts: [],
    general: [],
  };
  for (const d of docRows) documentsByGroup[documentGroupOf(d.docType)].push(d);

  return { clientId, folders: roots, documentsByGroup };
}

// ── Download access (§13) ─────────────────────────────────────────────────

export interface DocumentAccessContext {
  /** Portal workstream seam: client ids the portal user may see (§7 links). */
  portalClientIds?: number[] | null;
}

/**
 * Lower-level access assertion exported for the portal workstream: staff are
 * checked against the role-scoping seam (visibleClientIds); portal roles are
 * checked against the caller-supplied portalClientIds. Throws AuthError(403).
 */
export async function assertDocumentAccess(
  userId: number,
  role: UserRole,
  document: Pick<DocumentRow, "clientId">,
  ctx: DocumentAccessContext = {},
): Promise<void> {
  if (role === "client" || role === "cpa") {
    const allowed = ctx.portalClientIds ?? [];
    if (document.clientId != null && allowed.includes(document.clientId)) return;
    throw new AuthError(403, "You do not have access to this document");
  }
  const visible = await visibleClientIds(userId);
  if (visible === null) return; // unrestricted staff (pre-auth seam, queue.ts)
  if (document.clientId != null && visible.includes(document.clientId)) return;
  throw new AuthError(403, "You do not have access to this document");
}

/**
 * Staff download check: client access per the role-scoping seam. Portal
 * users are denied here on purpose - the portal surface calls
 * assertDocumentAccess directly with its resolved portalClientIds.
 */
export async function canDownloadDocument(
  user: SessionUser,
  document: Pick<DocumentRow, "clientId">,
): Promise<boolean> {
  if (user.normalizedRole === "client" || user.normalizedRole === "cpa") return false;
  try {
    await assertDocumentAccess(user.id, user.normalizedRole, document);
    return true;
  } catch {
    return false;
  }
}

// ── Deletion (§13) ────────────────────────────────────────────────────────

async function unlinkIfUnreferenced(storedPath: string): Promise<void> {
  const remaining = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.storedPath, storedPath))
    .limit(1);
  if (remaining.length > 0) return;
  const driver = await getStorageDriver();
  await driver.delete(storedPath);
}

/**
 * §13 deletion rules: admin/owner, the original uploader, staff on the same
 * day as the upload, or can_access_statements holders (for statements).
 * The file is unlinked only when the last row referencing it is deleted.
 */
export function canDeleteDocument(user: SessionUser, document: DocumentRow, today: LocalDate): boolean {
  const role = user.normalizedRole;
  if (role === "owner" || role === "admin") return true;
  if (document.uploadedById != null && document.uploadedById === user.id) return true;
  const isStaff = role === "manager" || role === "bookkeeper";
  if (isStaff && document.createdAt) {
    const uploadedDay = localToday(new Date(document.createdAt));
    if (compareLocalDate(uploadedDay, today) === 0) return true;
  }
  if (document.docType === "statement" && canAccessStatements(user)) return true;
  return false;
}

export async function deleteDocument(
  documentId: number,
  user: SessionUser,
  today: LocalDate,
): Promise<void> {
  const document = await getDocumentById(documentId);
  if (!document) throw new DocumentError("That document no longer exists.");
  if (!canDeleteDocument(user, document, today)) {
    throw new AuthError(403, "You do not have permission to delete this document");
  }
  const storedPath = document.storedPath;
  await db.delete(documents).where(eq(documents.id, document.id));
  await unlinkIfUnreferenced(storedPath);
}

// ── Grid support (used by statements.ts) ──────────────────────────────────

/**
 * §6.7/§14 - uploaded months for an account, derived purely from Document
 * rows with doc_type='statement', preferring the stored attributed period
 * and falling back to the domain derivation for legacy rows without one.
 */
export async function uploadedStatementMonths(
  accountIds: number[],
): Promise<Map<number, { period: Month; document: DocumentRow }[]>> {
  const byAccount = new Map<number, { period: Month; document: DocumentRow }[]>();
  if (accountIds.length === 0) return byAccount;

  const wanted = new Set(accountIds);
  const [rows, accountRows, clientRows] = await Promise.all([
    db
      .select()
      .from(documents)
      .where(and(eq(documents.docType, "statement"), inArray(documents.accountId, accountIds))),
    db.select().from(accounts).where(inArray(accounts.id, accountIds)),
    db.select().from(clients),
  ]);
  const accountById = new Map(accountRows.map((a) => [a.id, a] as const));
  const clientById = new Map(clientRows.map((c) => [c.id, c] as const));

  for (const row of rows) {
    if (row.accountId == null || !wanted.has(row.accountId)) continue;
    let period: Month | null = null;
    if (row.attributedYear != null && row.attributedMonth != null) {
      period = { year: row.attributedYear, month: row.attributedMonth };
    } else if (row.statementDate) {
      // Legacy fallback (§6.1): derive from statement_date through the domain.
      const account = accountById.get(row.accountId);
      const client = account ? clientById.get(account.clientId) : undefined;
      if (account && client) {
        period = attributedPeriodForDate(
          account.statementDay,
          parseLocalDate(row.statementDate),
          tierOf(client),
        );
      }
    }
    if (!period) continue;
    const list = byAccount.get(row.accountId) ?? [];
    list.push({ period, document: row });
    byAccount.set(row.accountId, list);
  }
  return byAccount;
}
