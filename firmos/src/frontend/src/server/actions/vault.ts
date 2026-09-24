"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/server/auth/guards";
import {
  archiveCredential,
  copyCredentialSecret,
  createStaffCredential,
  getStaffCredentialDetail,
  purgeCredential,
  updateStaffCredential,
  VaultError,
  type CredentialInput,
  type VaultCredentialItem,
} from "@/server/vault";

/**
 * Staff vault actions (Phase 3B). Thin guarded wrappers over
 * src/server/vault.ts: requireStaff first (portal roles are rejected at the
 * guard), then the engine's role checks (owner/admin for writes, owner for
 * purge). The copy action is the only one that ever returns a secret, and it
 * answers with the plaintext alone - no row payload rides along with it.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

function fail(error: unknown): { ok: false; status: number; error: string } {
  if (error instanceof VaultError) return { ok: false, status: error.status, error: error.message };
  if (error instanceof Error && error.name === "AuthError") {
    return { ok: false, status: 403, error: error.message };
  }
  return { ok: false, status: 500, error: "Something went wrong - try again." };
}

export async function createCredentialAction(
  clientId: number,
  input: CredentialInput,
): Promise<ActionResult<VaultCredentialItem>> {
  try {
    const user = await requireStaff();
    const item = await createStaffCredential(user, clientId, input);
    revalidatePath(`/clients/${clientId}`);
    return { ok: true, data: item };
  } catch (error) {
    return fail(error);
  }
}

export async function updateCredentialAction(
  credentialId: number,
  patch: Partial<CredentialInput>,
): Promise<ActionResult<VaultCredentialItem>> {
  try {
    const user = await requireStaff();
    const item = await updateStaffCredential(user, credentialId, patch);
    revalidatePath(`/clients/${item.clientId}`);
    return { ok: true, data: item };
  } catch (error) {
    return fail(error);
  }
}

export async function archiveCredentialAction(
  credentialId: number,
): Promise<ActionResult<{ archived: true }>> {
  try {
    const user = await requireStaff();
    await archiveCredential(user, credentialId);
    return { ok: true, data: { archived: true } };
  } catch (error) {
    return fail(error);
  }
}

/** Owner-only hard purge (engine requires a prior archive). */
export async function purgeCredentialAction(
  credentialId: number,
): Promise<ActionResult<{ purged: true }>> {
  try {
    const user = await requireStaff();
    await purgeCredential(user, credentialId);
    return { ok: true, data: { purged: true } };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Copy-on-use: returns the decrypted password ONCE (clipboard hand-off),
 * rate-limited and audited. Nothing else in the app returns a secret.
 */
export async function copyCredentialSecretAction(
  credentialId: number,
): Promise<ActionResult<{ secret: string }>> {
  try {
    const user = await requireStaff();
    const result = await copyCredentialSecret(user, credentialId);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}

/** Opening the detail dialog is the audited username view (viewed_username). */
export async function credentialDetailAction(credentialId: number): Promise<
  ActionResult<{
    item: VaultCredentialItem;
    recentAccess: { action: string; userName: string | null; at: string }[];
  }>
> {
  try {
    const user = await requireStaff();
    const detail = await getStaffCredentialDetail(user, credentialId);
    return { ok: true, data: detail };
  } catch (error) {
    return fail(error);
  }
}
