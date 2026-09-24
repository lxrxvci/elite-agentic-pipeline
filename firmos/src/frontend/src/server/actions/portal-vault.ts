"use server";

import { requirePortalUser } from "@/server/auth/guards";
import { PortalError } from "@/server/portal";
import {
  portalArchiveCredential,
  portalSaveCredential,
  VaultError,
  type CredentialInput,
  type VaultCredentialItem,
} from "@/server/vault";

/**
 * Portal vault actions (Phase 3B, §12): the client enters their own bank /
 * software logins. Thin guarded wrappers over the vault engine's portal
 * functions - requirePortalUser rejects staff at the guard, the engine
 * enforces the kill switch, acting-client membership, the own-entry rule,
 * and 404-without-existence-leak on cross-client ids.
 *
 * No action here ever returns a secret: saves echo back the masked item.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

function fail(error: unknown): { ok: false; status: number; error: string } {
  if (error instanceof PortalError || error instanceof VaultError) {
    return { ok: false, status: error.status, error: error.message };
  }
  return { ok: false, status: 500, error: "Something went wrong - try again." };
}

export interface PortalCredentialSaveInput extends CredentialInput {
  /** Present = edit/fill that row; absent = new entry. */
  id?: number | null;
}

export async function savePortalCredential(
  clientId: number,
  input: PortalCredentialSaveInput,
): Promise<ActionResult<VaultCredentialItem>> {
  try {
    const user = await requirePortalUser();
    const item = await portalSaveCredential(user, clientId, input);
    return { ok: true, data: item };
  } catch (error) {
    return fail(error);
  }
}

export async function archivePortalCredential(
  clientId: number,
  credentialId: number,
): Promise<ActionResult<{ archived: true }>> {
  try {
    const user = await requirePortalUser();
    await portalArchiveCredential(user, clientId, credentialId);
    return { ok: true, data: { archived: true } };
  } catch (error) {
    return fail(error);
  }
}
