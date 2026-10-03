"use server";

import { revalidatePath } from "next/cache";

import { AuthError, requireRole, requireStaff } from "@/server/auth/guards";
import {
  addCustomService,
  listServicesCatalog,
  renameService,
  setCustomServicePrice,
  setServiceActive,
  setServiceAddon,
  type NewCustomServiceInput,
  type ServiceCatalogRow,
} from "@/server/services-catalog";

/**
 * K3 (J16): services catalog actions. Reads are staff-level (the intake
 * renders the catalog); every write is owner/admin and audited.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof AuthError) return { ok: false, error: error.message };
  const message = error instanceof Error ? error.message : "Something went wrong - try again.";
  return { ok: false, error: message };
}

async function requirePricingAdmin() {
  return requireRole("admin", "owner");
}

export async function listServicesCatalogAction(): Promise<ActionResult<ServiceCatalogRow[]>> {
  try {
    await requireStaff();
    return { ok: true, data: await listServicesCatalog() };
  } catch (error) {
    return fail(error);
  }
}

export async function addCustomServiceAction(input: NewCustomServiceInput): Promise<ActionResult<ServiceCatalogRow>> {
  try {
    const user = await requirePricingAdmin();
    const row = await addCustomService(input, user.id);
    revalidatePath("/admin/pricing");
    revalidatePath("/intake");
    return { ok: true, data: row };
  } catch (error) {
    return fail(error);
  }
}

export async function renameServiceAction(serviceKey: string, productName: string): Promise<ActionResult<{ done: true }>> {
  try {
    const user = await requirePricingAdmin();
    await renameService(serviceKey, productName, user.id);
    revalidatePath("/admin/pricing");
    revalidatePath("/intake");
    return { ok: true, data: { done: true } };
  } catch (error) {
    return fail(error);
  }
}

export async function setServiceActiveAction(serviceKey: string, active: boolean): Promise<ActionResult<{ done: true }>> {
  try {
    const user = await requirePricingAdmin();
    await setServiceActive(serviceKey, active, user.id);
    revalidatePath("/admin/pricing");
    revalidatePath("/intake");
    return { ok: true, data: { done: true } };
  } catch (error) {
    return fail(error);
  }
}

export async function setCustomServicePriceAction(serviceKey: string, unitPrice: number): Promise<ActionResult<{ done: true }>> {
  try {
    const user = await requirePricingAdmin();
    await setCustomServicePrice(serviceKey, unitPrice, user.id);
    revalidatePath("/admin/pricing");
    revalidatePath("/intake");
    return { ok: true, data: { done: true } };
  } catch (error) {
    return fail(error);
  }
}

export async function setServiceAddonAction(serviceKey: string, isAddon: boolean): Promise<ActionResult<{ done: true }>> {
  try {
    const user = await requirePricingAdmin();
    await setServiceAddon(serviceKey, isAddon, user.id);
    revalidatePath("/admin/pricing");
    revalidatePath("/intake");
    return { ok: true, data: { done: true } };
  } catch (error) {
    return fail(error);
  }
}
