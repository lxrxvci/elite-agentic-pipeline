import { getSessionUser } from "@/server/auth/guards";
import { ChatError, getAttachmentForDownload } from "@/server/chat";
import { StorageError, getStorageDriver } from "@/server/storage";

/**
 * Chat attachment download (HANDOFF §16). Membership-gated by construction
 * through getAttachmentForDownload; bytes stream through the §13 storage
 * driver. Error responses are fixed strings - storage paths never leak.
 */

function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ messageId: string }> },
): Promise<Response> {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const { messageId } = await params;
  const id = Number(messageId);
  if (!Number.isInteger(id)) {
    return Response.json({ error: "Attachment not found" }, { status: 404 });
  }

  let attachment: { path: string; fileName: string } | null;
  try {
    attachment = await getAttachmentForDownload(id, user.id);
  } catch (err) {
    if (err instanceof ChatError) {
      return Response.json(
        { error: err.status === 404 ? "Attachment not found" : "You do not have access to this file" },
        { status: err.status },
      );
    }
    throw err;
  }
  if (!attachment) {
    return Response.json({ error: "Attachment not found" }, { status: 404 });
  }

  try {
    const driver = await getStorageDriver();
    const bytes = await driver.get(attachment.path);
    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": contentDisposition(attachment.fileName),
        "content-length": String(bytes.length),
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof StorageError && err.code === "not_found") {
      return Response.json({ error: "Attachment not found" }, { status: 404 });
    }
    return Response.json({ error: "The file could not be retrieved" }, { status: 500 });
  }
}
