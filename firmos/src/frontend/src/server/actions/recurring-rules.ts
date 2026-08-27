"use server";

import { revalidatePath } from "next/cache";

import {
  createClientRule,
  deleteClientRule,
  listClientRules,
  setRuleActive,
  updateClientRule,
  type CreateRuleResult,
  type DeleteRuleResult,
  type RecurringRuleInput,
  type SetRuleActiveResult,
  type UpdateRuleResult,
} from "@/server/recurring-rules";
import { requireRole, requireStaff } from "@/server/auth/guards";

/**
 * Recurring rule actions (HANDOFF §6.4) - the client Recurring tab's writes.
 * Manager+ may manage rules; bookkeepers read only. Every write revalidates
 * the client page (the tab table) and /workstation (generated task queues
 * reflect retired instances and paused rules after the next refresh).
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : "Something went wrong - try again.";
  return { ok: false, error: message };
}

function revalidateClient(clientId: number) {
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/workstation");
}

export async function listClientRulesAction(
  clientId: number,
): Promise<ActionResult<Awaited<ReturnType<typeof listClientRules>>>> {
  try {
    await requireStaff();
    return { ok: true, data: await listClientRules(clientId) };
  } catch (error) {
    return fail(error);
  }
}

export async function createClientRuleAction(
  clientId: number,
  input: RecurringRuleInput,
): Promise<ActionResult<CreateRuleResult>> {
  try {
    const user = await requireRole("manager", "admin", "owner");
    const result = await createClientRule(clientId, input, user.id);
    revalidateClient(clientId);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}

export async function updateClientRuleAction(
  ruleId: number,
  input: RecurringRuleInput,
): Promise<ActionResult<UpdateRuleResult>> {
  try {
    const user = await requireRole("manager", "admin", "owner");
    const result = await updateClientRule(ruleId, input, user.id);
    revalidateClient(result.clientId);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}

export async function setRuleActiveAction(
  ruleId: number,
  active: boolean,
): Promise<ActionResult<SetRuleActiveResult>> {
  try {
    const user = await requireRole("manager", "admin", "owner");
    const result = await setRuleActive(ruleId, active, user.id);
    revalidateClient(result.clientId);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteClientRuleAction(ruleId: number): Promise<ActionResult<DeleteRuleResult>> {
  try {
    const user = await requireRole("manager", "admin", "owner");
    const result = await deleteClientRule(ruleId, user.id);
    revalidateClient(result.clientId);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}
