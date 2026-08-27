/**
 * Shared portal constants (HANDOFF §12). Kept out of the server-action
 * module because 'use server' files may only export async functions.
 */

/** §12 - portal general uploads land only in this folder whitelist. */
export const PORTAL_UPLOAD_FOLDERS = ['Receipts', 'General'] as const
export type PortalUploadFolder = (typeof PORTAL_UPLOAD_FOLDERS)[number]

/** Canonicalize a folder name against the whitelist (case-insensitive). */
export function canonicalUploadFolder(raw: string | null): PortalUploadFolder | null {
  return PORTAL_UPLOAD_FOLDERS.find((f) => f.toLowerCase() === (raw ?? '').toLowerCase()) ?? null
}
