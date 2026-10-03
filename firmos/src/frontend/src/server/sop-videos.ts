import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { sopVideos } from "@/db/schema";
import { logEvent } from "@/server/audit";
import { getStorageDriver, storageDriverName, type StorageDriverName } from "@/server/storage";
import { extensionOf } from "@/server/uploads";

/**
 * K2 (meeting 09_30, 01:16:00): native SOP walkthrough videos - the in-house
 * Loom replacement. Rows in sop_videos point at bytes in the §13 storage
 * driver under sop-videos/{sopId}/...; recording happens in the browser
 * (getDisplayMedia + MediaRecorder), uploads arrive either client-direct to
 * the blob store (prod, bypassing the serverless body limit) or through the
 * local upload route (dev), and every write is audited + can_edit_sops-gated
 * at the action layer. Playback streams through /api/sop-videos/[id] with
 * Range support after a staff-session check.
 */

export interface SopVideoRow {
  id: number;
  sopTemplateId: number;
  uploadedById: number | null;
  title: string;
  storedPath: string;
  mimeType: string;
  sizeBytes: number;
  durationSecs: number | null;
  createdAt: Date;
}

/** The upload route advertises this so the recorder picks its upload path. */
export function sopVideoStorageMode(): StorageDriverName {
  return storageDriverName();
}

/** Storage path layout for a recording (§13 - always relative). */
export function sopVideoPath(sopTemplateId: number, fileName: string): string {
  const clean = fileName.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-");
  return `sop-videos/${sopTemplateId}/${Date.now()}-${clean}`;
}

/**
 * A registered video's stored path must live under its SOP's prefix with a
 * video extension - the guard against a staff session registering a row for
 * an arbitrary blob path.
 */
export function isValidSopVideoPath(sopTemplateId: number, storedPath: string): boolean {
  if (!storedPath.startsWith(`sop-videos/${sopTemplateId}/`)) return false;
  if (storedPath.includes("..")) return false;
  return ["webm", "mp4"].includes(extensionOf(storedPath));
}

export async function listSopVideos(sopTemplateIds: number[]): Promise<SopVideoRow[]> {
  if (sopTemplateIds.length === 0) return [];
  return db
    .select()
    .from(sopVideos)
    .where(inArray(sopVideos.sopTemplateId, sopTemplateIds))
    .orderBy(desc(sopVideos.createdAt));
}

export async function getSopVideo(videoId: number): Promise<SopVideoRow | null> {
  const rows = await db.select().from(sopVideos).where(eq(sopVideos.id, videoId)).limit(1);
  return rows[0] ?? null;
}

export interface RegisterSopVideoInput {
  sopTemplateId: number;
  title: string;
  storedPath: string;
  mimeType: string;
  sizeBytes: number;
  durationSecs: number | null;
}

/** Insert the row after the bytes landed; the write is audited. */
export async function registerSopVideo(
  input: RegisterSopVideoInput,
  userId: number,
): Promise<SopVideoRow> {
  if (!isValidSopVideoPath(input.sopTemplateId, input.storedPath)) {
    throw new Error("The video path is not valid for this SOP.");
  }
  const rows = await db
    .insert(sopVideos)
    .values({
      sopTemplateId: input.sopTemplateId,
      uploadedById: userId,
      title: input.title.trim() || "SOP walkthrough",
      storedPath: input.storedPath,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      durationSecs: input.durationSecs,
    })
    .returning();
  const row = rows[0];
  await logEvent({
    userId,
    action: "sop_video_uploaded",
    entityType: "sop_video",
    entityId: row.id,
    metadata: { sopTemplateId: input.sopTemplateId, title: row.title, sizeBytes: row.sizeBytes },
  });
  return row;
}

/** Delete the row and the stored bytes; audited. Missing bytes don't fail. */
export async function deleteSopVideo(videoId: number, userId: number): Promise<{ deleted: true }> {
  const row = await getSopVideo(videoId);
  if (!row) throw new Error("Video not found.");
  await db.delete(sopVideos).where(and(eq(sopVideos.id, videoId), eq(sopVideos.sopTemplateId, row.sopTemplateId)));
  const driver = await getStorageDriver();
  await driver.delete(row.storedPath);
  await logEvent({
    userId,
    action: "sop_video_deleted",
    entityType: "sop_video",
    entityId: videoId,
    metadata: { sopTemplateId: row.sopTemplateId, title: row.title },
  });
  return { deleted: true };
}
