import { getSessionUser } from "@/server/auth/guards";
import { getSopVideo } from "@/server/sop-videos";
import { getStorageDriver, StorageError } from "@/server/storage";

/**
 * K2 SOP video playback. Staff-only (SOPs are internal training material -
 * portal roles never read them). The blob driver redirects to its private
 * download URL (which serves Range natively); the local driver streams with
 * RFC 7233 single-range support so <video> seeking works.
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  if (user.normalizedRole === "client" || user.normalizedRole === "cpa") {
    return Response.json({ error: "You do not have access to this video" }, { status: 403 });
  }

  const { id } = await params;
  const videoId = Number(id);
  if (!Number.isInteger(videoId)) {
    return Response.json({ error: "Video not found" }, { status: 404 });
  }
  const video = await getSopVideo(videoId);
  if (!video) {
    return Response.json({ error: "Video not found" }, { status: 404 });
  }

  const driver = await getStorageDriver();
  const signed = await driver.signedUrl(video.storedPath);
  if (signed) {
    return Response.redirect(signed, 302);
  }

  try {
    const bytes = await driver.get(video.storedPath);
    const total = bytes.length;
    const range = request.headers.get("range");
    const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
    if (match && (match[1] !== "" || match[2] !== "")) {
      const start = match[1] === "" ? Math.max(0, total - Number(match[2])) : Number(match[1]);
      const end = match[1] !== "" && match[2] !== "" ? Math.min(total - 1, Number(match[2])) : total - 1;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
        return new Response(null, {
          status: 416,
          headers: { "content-range": `bytes */${total}` },
        });
      }
      return new Response(Buffer.from(bytes.subarray(start, end + 1)), {
        status: 206,
        headers: {
          "content-type": video.mimeType,
          "content-length": String(end - start + 1),
          "content-range": `bytes ${start}-${end}/${total}`,
          "accept-ranges": "bytes",
          "cache-control": "private, no-store",
        },
      });
    }
    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": video.mimeType,
        "content-length": String(total),
        "accept-ranges": "bytes",
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof StorageError && err.code === "not_found") {
      return Response.json({ error: "Video not found" }, { status: 404 });
    }
    return Response.json({ error: "The video could not be retrieved" }, { status: 500 });
  }
}
