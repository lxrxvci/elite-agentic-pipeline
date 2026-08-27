import { AuthError, getSessionUser, type SessionUser } from "@/server/auth/guards";
import { assertDocumentAccess, getDocumentById, type DocumentRow } from "@/server/documents";
import { PortalError, getPortalContext } from "@/server/portal";
import { StorageError, getStorageDriver } from "@/server/storage";

/**
 * Document download (HANDOFF §13). Streams the file through the storage
 * driver after the access check; the local driver resolves the stored path
 * through absDocPath, which rejects ".." and verifies containment under the
 * docs root before a single byte is read. Error responses are fixed strings
 * - storage paths never leak.
 */

const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  txt: "text/plain",
  zip: "application/zip",
};

function contentTypeOf(mimeType: string | null, fileName: string): string {
  if (mimeType) return mimeType;
  const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase() : "";
  return EXT_MIME[ext] ?? "application/octet-stream";
}

/** RFC 6266: ASCII fallback plus UTF-8 filename* for the download name. */
function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * §12 CPA download scoping: a CPA may only fetch documents that live on the
 * CPA-visible surfaces (statements grid, tax documents, delivered reports).
 * Anything else (receipts, general uploads, arbitrary ids) is denied even
 * when the document belongs to a linked client. The deterministic §13 layout
 * puts these under {client}/Documents/{Statements|Tax|Reports}/...; the
 * doc_type check covers rows whose folder naming predates the layout.
 */
const CPA_DOC_TYPES: ReadonlySet<string> = new Set(["statement", "tax", "w9", "report"]);
const CPA_FOLDER_PREFIXES: ReadonlySet<string> = new Set(["statements", "tax", "reports"]);

function cpaCanDownload(document: DocumentRow): boolean {
  if (CPA_DOC_TYPES.has(document.docType)) return true;
  const segments = document.storedPath.split("/");
  const folder = segments[1] === "Documents" ? (segments[2] ?? "").toLowerCase() : "";
  return CPA_FOLDER_PREFIXES.has(folder);
}

/**
 * Portal access resolution (§12): the linked-client set comes from
 * getPortalContext (which enforces the kill switch), and CPAs are
 * additionally folder-prefix scoped. Returns a Response to short-circuit
 * with, or null when the download may proceed.
 */
async function checkPortalDownloadAccess(
  user: SessionUser,
  document: DocumentRow,
): Promise<Response | null> {
  try {
    const ctx = await getPortalContext(user);
    if (user.normalizedRole === "cpa" && !cpaCanDownload(document)) {
      return Response.json({ error: "You do not have access to this document" }, { status: 403 });
    }
    await assertDocumentAccess(user.id, user.normalizedRole, document, {
      portalClientIds: ctx.clients.map((c) => c.clientId),
    });
    return null;
  } catch (err) {
    if (err instanceof PortalError) {
      // §12 kill switch: a disabled portal answers 404, indistinguishable
      // from one that was never built.
      return Response.json({ error: "Not found" }, { status: err.status === 404 ? 404 : 403 });
    }
    if (err instanceof AuthError) {
      return Response.json({ error: "You do not have access to this document" }, { status: 403 });
    }
    throw err;
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const { id } = await params;
  const documentId = Number(id);
  if (!Number.isInteger(documentId)) {
    return Response.json({ error: "Document not found" }, { status: 404 });
  }

  const document = await getDocumentById(documentId);
  if (!document) {
    return Response.json({ error: "Document not found" }, { status: 404 });
  }

  try {
    // Staff: role-scoping seam (visibleClientIds). Portal roles: the
    // linked-client set from getPortalContext, with CPA downloads
    // additionally scoped to statement/tax/report paths (§12).
    if (user.normalizedRole === "client" || user.normalizedRole === "cpa") {
      const denied = await checkPortalDownloadAccess(user, document);
      if (denied) return denied;
    } else {
      await assertDocumentAccess(user.id, user.normalizedRole, document, { portalClientIds: [] });
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return Response.json({ error: "You do not have access to this document" }, { status: 403 });
    }
    throw err;
  }

  try {
    const driver = await getStorageDriver();
    const bytes = await driver.get(document.storedPath);
    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": contentTypeOf(document.mimeType, document.fileName),
        "content-disposition": contentDisposition(document.fileName),
        "content-length": String(bytes.length),
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof StorageError && err.code === "not_found") {
      return Response.json({ error: "Document not found" }, { status: 404 });
    }
    return Response.json({ error: "The file could not be retrieved" }, { status: 500 });
  }
}
