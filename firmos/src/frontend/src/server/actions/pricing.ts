"use server";

import { revalidatePath } from "next/cache";

import type { CommissionTier } from "@firmos/domain";

import { requireRole } from "@/server/auth/guards";
import { setCommissionFloorRate, setCommissionTiers, setPricingOverride } from "@/server/pricing-config";

/**
 * /admin/pricing server actions (owner call notes: pricing and commission
 * tiers are admin-editable, no code change required). Admin/owner only;
 * validation and audit logging live in server/pricing-config.ts.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : "Something went wrong - try again.";
  return { ok: false, error: message };
}

/** Set (price) or clear (null) one service's price override. */
export async function setPricingOverrideAction(
  serviceKey: string,
  price: number | null,
): Promise<ActionResult<{ overrides: Record<string, number> }>> {
  try {
    const actor = await requireRole("admin", "owner");
    const overrides = await setPricingOverride(serviceKey, price, actor.id);
    revalidatePath("/admin/pricing");
    return { ok: true, data: { overrides } };
  } catch (error) {
    return fail(error);
  }
}

/** Replace the commission tier table (thresholds strictly descending). */
export async function setCommissionTiersAction(
  tiers: CommissionTier[],
): Promise<ActionResult<{ tiers: CommissionTier[] }>> {
  try {
    const actor = await requireRole("admin", "owner");
    const saved = await setCommissionTiers(tiers, actor.id);
    revalidatePath("/admin/pricing");
    return { ok: true, data: { tiers: saved } };
  } catch (error) {
    return fail(error);
  }
}

/** Set the commission floor rate (below the lowest tier; the no-data case). */
export async function setCommissionFloorRateAction(
  rate: number,
): Promise<ActionResult<number>> {
  try {
    const actor = await requireRole("admin", "owner");
    const saved = await setCommissionFloorRate(rate, actor.id);
    revalidatePath("/admin/pricing");
    return { ok: true, data: saved };
  } catch (error) {
    return fail(error);
  }
}
