import { asc, eq } from "drizzle-orm";

import { PRICING, type PricingEntry } from "@firmos/domain";

import { db } from "@/db";
import { servicesCatalog } from "@/db/schema";
import { logEvent } from "@/server/audit";

/**
 * K3 (J16, "admin-configurable everything"): the services catalog. Canonical
 * rows mirror the domain PRICING table (seeded); custom services are new
 * rows with their own key + price and price into quotes WITHOUT a deploy.
 *
 * Effective pricing for a quote = catalog custom entries UNDER the canonical
 * PRICING table, admin pricing_overrides on top (unchanged). The catalog
 * never edits canonical prices - that's pricing_overrides' job - it owns
 * membership (which rows are standards/add-ons on the services screen),
 * labels, activation, and custom services end to end.
 */

export interface ServiceCatalogRow {
  id: number;
  serviceKey: string;
  productName: string;
  group: string;
  unit: string;
  unitPrice: number | null;
  scaling: string;
  bucket: string;
  isStandard: boolean;
  isAddon: boolean;
  isActive: boolean;
  position: number;
  /** Custom services are catalog-created rows (key not in PRICING). */
  isCustom: boolean;
}

export class ServicesCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServicesCatalogError";
  }
}

const STANDARD_KEYS = new Set(["bank_feed_management", "account_reconciliations"]);
const ADDON_KEYS = new Set([
  "invoicing",
  "payment_processing",
  "class_tracking",
  "location_tracking",
  "additional_therapist_tracking",
]);

function rowFromPricing(key: string, entry: PricingEntry): Omit<ServiceCatalogRow, "id"> {
  return {
    serviceKey: key,
    productName: entry.product_name,
    group: entry.group,
    unit: entry.unit,
    unitPrice: null, // canonical prices follow PRICING + overrides
    scaling: entry.scaling,
    bucket: entry.bucket,
    isStandard: STANDARD_KEYS.has(key),
    isAddon: ADDON_KEYS.has(key),
    isActive: true,
    position: 0,
    isCustom: false,
  };
}

function toRow(r: typeof servicesCatalog.$inferSelect): ServiceCatalogRow {
  return {
    id: r.id,
    serviceKey: r.serviceKey,
    productName: r.productName,
    group: r.group,
    unit: r.unit,
    unitPrice: r.unitPrice,
    scaling: r.scaling,
    bucket: r.bucket,
    isStandard: r.isStandard,
    isAddon: r.isAddon,
    isActive: r.isActive,
    position: r.position,
    isCustom: PRICING[r.serviceKey] == null,
  };
}

/**
 * The catalog as read by surfaces: canonical PRICING keys (mirrored, so an
 * added-before-catalog key still appears) with any admin row edits applied,
 * then custom rows, all in position/name order.
 */
export async function listServicesCatalog(): Promise<ServiceCatalogRow[]> {
  const rows = await db.select().from(servicesCatalog).orderBy(asc(servicesCatalog.position), asc(servicesCatalog.productName));
  const byKey = new Map(rows.map((r) => [r.serviceKey, toRow(r)]));
  const out: ServiceCatalogRow[] = [];
  for (const [key, entry] of Object.entries(PRICING)) {
    out.push(byKey.get(key) ?? { id: -1, ...rowFromPricing(key, entry) });
    byKey.delete(key);
  }
  out.push(...byKey.values());
  return out.sort((a, b) => a.productName.toLowerCase().localeCompare(b.productName.toLowerCase()));
}

/** Custom catalog entries in the shape the domain pricing table takes. */
export async function getCustomServiceEntries(): Promise<Record<string, PricingEntry>> {
  const rows = await db.select().from(servicesCatalog).where(eq(servicesCatalog.isActive, true));
  const out: Record<string, PricingEntry> = {};
  for (const r of rows) {
    if (PRICING[r.serviceKey] != null) continue; // canonical keys stay PRICING-driven
    out[r.serviceKey] = {
      product_name: r.productName,
      group: r.group as PricingEntry["group"],
      unit_price: r.unitPrice,
      unit: r.unit,
      scaling: r.scaling as PricingEntry["scaling"],
      bucket: r.bucket as PricingEntry["bucket"],
    };
  }
  return out;
}

/** Seed canonical rows (idempotent) so the admin can edit membership/labels. */
export async function seedServicesCatalog(): Promise<number> {
  const existing = new Set((await db.select({ key: servicesCatalog.serviceKey }).from(servicesCatalog)).map((r) => r.key));
  const missing = Object.entries(PRICING).filter(([key]) => !existing.has(key));
  if (missing.length === 0) return 0;
  await db
    .insert(servicesCatalog)
    .values(
      missing.map(([key, entry]) => {
        const { isCustom: _, ...row } = rowFromPricing(key, entry);
        return row;
      }),
    )
    .onConflictDoNothing({ target: servicesCatalog.serviceKey });
  return missing.length;
}

/** Slug a service key from the product name; "Custom P&L by Property" -> custom_pnl_by_property. */
export function slugServiceKey(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug === "" ? "custom_service" : slug;
}

export interface NewCustomServiceInput {
  productName: string;
  group: string;
  unit: string;
  unitPrice: number;
  scaling: string;
  bucket: string;
  isAddon: boolean;
}

/** Add a custom service (admin). It prices into quotes immediately. */
export async function addCustomService(input: NewCustomServiceInput, userId: number): Promise<ServiceCatalogRow> {
  const name = input.productName.trim().replace(/\s+/g, " ");
  if (name === "") throw new ServicesCatalogError("Give the service a name first.");
  if (!Number.isFinite(input.unitPrice) || input.unitPrice < 0 || input.unitPrice > 999999) {
    throw new ServicesCatalogError("Give the service a price (0 is fine for quoted-at-review lines).");
  }
  let key = slugServiceKey(name);
  if (PRICING[key] != null) throw new ServicesCatalogError(`"${name}" collides with a standard service key - rename it slightly.`);
  const existing = await db.select({ id: servicesCatalog.id }).from(servicesCatalog).where(eq(servicesCatalog.serviceKey, key)).limit(1);
  if (existing.length > 0) key = `${key}_${existing.length + 1}`;

  const rows = await db
    .insert(servicesCatalog)
    .values({
      serviceKey: key,
      productName: name,
      group: input.group,
      unit: input.unit,
      unitPrice: input.unitPrice,
      scaling: input.scaling,
      bucket: input.bucket,
      isStandard: false,
      isAddon: input.isAddon,
      isActive: true,
    })
    .returning();
  await logEvent({
    userId,
    action: "service_added",
    entityType: "services_catalog",
    entityId: rows[0].id,
    metadata: { serviceKey: key, productName: name, unitPrice: input.unitPrice },
  });
  return toRow(rows[0]);
}

/** Rename a label (any row; canonical keys keep their service key). */
export async function renameService(serviceKey: string, productName: string, userId: number): Promise<void> {
  const name = productName.trim().replace(/\s+/g, " ");
  if (name === "") throw new ServicesCatalogError("Give the service a name first.");
  const updated = await db
    .update(servicesCatalog)
    .set({ productName: name, updatedAt: new Date() })
    .where(eq(servicesCatalog.serviceKey, serviceKey))
    .returning({ id: servicesCatalog.id });
  if (updated.length === 0) throw new ServicesCatalogError("That service is not in the catalog yet.");
  await logEvent({ userId, action: "service_renamed", entityType: "services_catalog", entityId: updated[0].id, metadata: { serviceKey, productName: name } });
}

/** Activate/deactivate (audited). Hidden services stop offering on intake. */
export async function setServiceActive(serviceKey: string, active: boolean, userId: number): Promise<void> {
  const updated = await db
    .update(servicesCatalog)
    .set({ isActive: active, updatedAt: new Date() })
    .where(eq(servicesCatalog.serviceKey, serviceKey))
    .returning({ id: servicesCatalog.id });
  if (updated.length === 0) throw new ServicesCatalogError("That service is not in the catalog yet.");
  await logEvent({
    userId,
    action: active ? "service_activated" : "service_deactivated",
    entityType: "services_catalog",
    entityId: updated[0].id,
    metadata: { serviceKey },
  });
}

/** Edit a CUSTOM service's price (canonical prices live in pricing overrides). */
export async function setCustomServicePrice(serviceKey: string, unitPrice: number, userId: number): Promise<void> {
  if (PRICING[serviceKey] != null) throw new ServicesCatalogError("Canonical prices edit from the pricing table above.");
  if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 999999) {
    throw new ServicesCatalogError("Give the service a valid price.");
  }
  const updated = await db
    .update(servicesCatalog)
    .set({ unitPrice, updatedAt: new Date() })
    .where(eq(servicesCatalog.serviceKey, serviceKey))
    .returning({ id: servicesCatalog.id });
  if (updated.length === 0) throw new ServicesCatalogError("That service is not in the catalog yet.");
  await logEvent({ userId, action: "service_price_set", entityType: "services_catalog", entityId: updated[0].id, metadata: { serviceKey, unitPrice } });
}

/** Toggle a row's add-on membership (shows/hides it as a services-screen toggle). */
export async function setServiceAddon(serviceKey: string, isAddon: boolean, userId: number): Promise<void> {
  const updated = await db
    .update(servicesCatalog)
    .set({ isAddon, updatedAt: new Date() })
    .where(eq(servicesCatalog.serviceKey, serviceKey))
    .returning({ id: servicesCatalog.id });
  if (updated.length === 0) throw new ServicesCatalogError("That service is not in the catalog yet.");
  await logEvent({ userId, action: "service_addon_toggled", entityType: "services_catalog", entityId: updated[0].id, metadata: { serviceKey, isAddon } });
}
