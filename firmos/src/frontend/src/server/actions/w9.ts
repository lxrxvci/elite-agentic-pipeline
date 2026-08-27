"use server";

import { revalidatePath } from "next/cache";

import { requireRole, requireStaff } from "@/server/auth/guards";
import {
  createW9Recipient,
  deleteW9Recipient,
  emailW9Request,
  exportOregonCsv,
  getW9Summary,
  listW9Recipients,
  mark1099Sent,
  markW9Received,
  updateW9Recipient,
  uploadW9Document,
  type W9RecipientInput,
} from "@/server/w9";

/**
 * W-9 / 1099 server actions (HANDOFF §18). Staff-level for the workflow;
 * deletes are manager+. Requests are emailed on demand - there is no
 * automated reminder job.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : "Something went wrong - try again.";
  return { ok: false, error: message };
}

export async function listW9RecipientsAction(year: number, clientId?: number) {
  try {
    await requireStaff();
    return { ok: true, data: await listW9Recipients(year, clientId) };
  } catch (error) {
    return fail(error);
  }
}

export async function createW9RecipientAction(input: W9RecipientInput) {
  try {
    const user = await requireStaff();
    const row = await createW9Recipient(user.id, input);
    revalidatePath(`/clients/${input.clientId}`);
    return { ok: true, data: row };
  } catch (error) {
    return fail(error);
  }
}

export async function updateW9RecipientAction(
  recipientId: number,
  patch: Partial<Omit<W9RecipientInput, "clientId" | "year">>,
) {
  try {
    const user = await requireStaff();
    return { ok: true, data: await updateW9Recipient(user.id, recipientId, patch) };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteW9RecipientAction(recipientId: number) {
  try {
    const user = await requireRole("manager", "admin", "owner");
    await deleteW9Recipient(user.id, recipientId);
    return { ok: true, data: { deleted: true } };
  } catch (error) {
    return fail(error);
  }
}

export async function markW9ReceivedAction(recipientId: number, receivedDate?: string) {
  try {
    const user = await requireStaff();
    return { ok: true, data: await markW9Received(recipientId, user.id, receivedDate) };
  } catch (error) {
    return fail(error);
  }
}

/** §18 - uploading the W-9 creates the linked doc_type='w9' Document. */
export async function uploadW9DocumentAction(
  recipientId: number,
  file: { fileName: string; bytes: Uint8Array; mimeType?: string | null },
) {
  try {
    const user = await requireStaff();
    const result = await uploadW9Document(recipientId, file, user.id);
    revalidatePath(`/clients/${result.recipient.clientId}`);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}

export async function mark1099SentAction(recipientId: number, sentDate?: string) {
  try {
    const user = await requireStaff();
    return { ok: true, data: await mark1099Sent(recipientId, user.id, sentDate) };
  } catch (error) {
    return fail(error);
  }
}

export async function getW9SummaryAction(year: number) {
  try {
    await requireStaff();
    return { ok: true, data: await getW9Summary(year) };
  } catch (error) {
    return fail(error);
  }
}

export async function exportOregonCsvAction(year: number) {
  try {
    await requireStaff();
    return { ok: true, data: await exportOregonCsv(year) };
  } catch (error) {
    return fail(error);
  }
}

/** §18 - on demand only; no automated reminder job exists. */
export async function emailW9RequestAction(recipientId: number, emailAddress: string) {
  try {
    const user = await requireStaff();
    return { ok: true, data: await emailW9Request(recipientId, emailAddress, user.id) };
  } catch (error) {
    return fail(error);
  }
}
