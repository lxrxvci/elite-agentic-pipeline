import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

import { AuthError, canEditSops, getSessionUser } from "@/server/auth/guards";
import { sopVideoPath } from "@/server/sop-videos";
import { getStorageDriver, storageDriverName } from "@/server/storage";
import { MAX_VIDEO_BYTES, validateVideoUpload, UploadValidationError } from "@/server/uploads";

/**
 * K2 SOP video upload - two modes behind one route:
 *
 *  - `vercel-blob` (prod): client-direct upload via @vercel/blob/client's
 *    handleUpload handshake, so recordings never pass through the serverless
 *    body limit. onBeforeGenerateToken is the auth + constraint gate.
 *  - `local` (dev/test): a plain multipart POST of the recording; the full
 *    §13 video validation branch runs here before the bytes hit disk.
 *
 * In both modes the client then calls registerSopVideoAction to attach the
 * row (which validates the stored path against the SOP prefix).
 */

const PATH_PATTERN = /^sop-videos\/\d+\/[\w.-]+\.(webm|mp4)$/;

export async function POST(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!canEditSops(user)) {
    return Response.json({ error: "Requires the can_edit_sops permission" }, { status: 403 });
  }

  if (storageDriverName() === "vercel-blob") {
    const body = (await request.json()) as HandleUploadBody;
    try {
      const jsonResponse = await handleUpload({
        body,
        request,
        onBeforeGenerateToken: async (pathname) => {
          if (!PATH_PATTERN.test(pathname)) {
            throw new Error("Videos upload under sop-videos/{sopId}/ only.");
          }
          return {
            access: "private",
            allowedContentTypes: ["video/webm", "video/mp4"],
            maximumSizeInBytes: MAX_VIDEO_BYTES,
            addRandomSuffix: false,
          };
        },
        onUploadCompleted: async () => {
          // The row is registered by the client via registerSopVideoAction.
        },
      });
      return Response.json(jsonResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The upload could not start.";
      return Response.json({ error: message }, { status: 400 });
    }
  }

  // Local driver: validate + store the recording directly.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected a multipart upload." }, { status: 400 });
  }
  const file = form.get("file");
  const sopTemplateId = Number(form.get("sopTemplateId"));
  if (!(file instanceof File) || !Number.isInteger(sopTemplateId) || sopTemplateId <= 0) {
    return Response.json({ error: "A recording and its SOP are required." }, { status: 400 });
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const validated = validateVideoUpload(file.name, file.type, bytes);
    const storedPath = sopVideoPath(sopTemplateId, validated.fileName);
    const driver = await getStorageDriver();
    await driver.put(storedPath, bytes);
    return Response.json({ storedPath, sizeBytes: bytes.length });
  } catch (error) {
    if (error instanceof UploadValidationError || error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ error: "The upload failed - try again." }, { status: 500 });
  }
}
