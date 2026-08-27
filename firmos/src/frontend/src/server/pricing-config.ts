import { eq } from "drizzle-orm";
import {
  COMMISSION_FLOOR_RATE,
  COMMISSION_TIERS,
  PRICING,
  mergedPricing,
  type CommissionTier,
  type PricingEntry,
} from "@firmos/domain";

import { db } from "@/db";
import { appSettings } from "@/db/schema";

import { logEvent } from "./audit";

/**
 * Admin-configurable pricing and commission tiers (owner call notes: "I
 * don't want to reach out and say can you build some code for this").
 *
 * Stored as two app_settings keys - pricing_overrides (service key -> price,
 * merged over the domain PRICING table) and commission_tiers (the on-time %
 * tier table, replacing the HANDOFF §6.6 default). Every write is validated
 * here and audit-logged; the role gate lives in the server action layer
 * (actions/pricing.ts), matching the setPayoutConfig precedent.
 *
 * Consumers never read app_settings directly: quotes and billing go through
 * calculateIntakeQuoteWithConfig (server/quote.ts), invoice line items
 * resolve overrides in buildItemizedLineItems (server/invoices.ts), and the
 * commission report threads getCommissionTiers() into the domain
 * commissionRate (server/payroll.ts).
 */

export class PricingConfigError extends Error {
  constructor(
    public readonly status: 400,
    message: string,
  ) {
    super(message);
    this.name = "PricingConfigError";
  }
}

const PRICING_OVERRIDES_KEY = "pricing_overrides";
const COMMISSION_TIERS_KEY = "commission_tiers";

/** Same money bounds as the admin user-pay fields (actions/admin.ts). */
const MAX_PRICE = 999999;

const round2 = (n: number): number => Math.round(n * 100) / 100;

async function readSetting(key: string): Promise<unknown> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return row?.value;
}

async function writeSetting(key: string, value: unknown, actorId: number): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value, updatedById: actorId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedById: actorId, updatedAt: new Date() },
    });
}

// ── Pricing overrides ───────────────────────────────────────────────────────

/**
 * The stored overrides, filtered defensively: a hand-edited row carrying an
 * unknown key or a non-number value cannot corrupt quoting - it is dropped
 * on read rather than trusted.
 */
export async function getPricingOverrides(): Promise<Record<string, number>> {
  const raw = await readSetting(PRICING_OVERRIDES_KEY);
  const out: Record<string, number> = {};
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!PRICING[key]) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Set (or with price null, remove) one service's price override. The key
 * must exist in the domain PRICING table; the price must be a finite,
 * non-negative amount. Every change is audit-logged with before/after.
 */
export async function setPricingOverride(
  serviceKey: string,
  price: number | null,
  actorId: number,
): Promise<Record<string, number>> {
  const entry = PRICING[serviceKey];
  if (!entry) throw new PricingConfigError(400, `Unknown service key: ${serviceKey}`);

  const overrides = await getPricingOverrides();
  const previous = overrides[serviceKey] ?? null;

  if (price == null) {
    if (previous == null) return overrides; // nothing to clear
    delete overrides[serviceKey];
  } else {
    if (!Number.isFinite(price) || price < 0 || price > MAX_PRICE) {
      throw new PricingConfigError(400, `Price must be a number between 0 and ${MAX_PRICE}`);
    }
    overrides[serviceKey] = round2(price);
  }

  await writeSetting(PRICING_OVERRIDES_KEY, overrides, actorId);
  await logEvent({
    userId: actorId,
    action: price == null ? "pricing_override_cleared" : "pricing_override_set",
    entityType: "app_settings",
    metadata: {
      key: PRICING_OVERRIDES_KEY,
      serviceKey,
      productName: entry.product_name,
      previousPrice: previous,
      newPrice: price == null ? null : round2(price),
      defaultPrice: entry.unit_price,
    },
  });
  return overrides;
}

export interface EffectivePricingRow {
  serviceKey: string;
  entry: PricingEntry;
  /** The stored admin override; null when the row prices at the default. */
  override: number | null;
  /** override when set, else the HANDOFF default (null = unpriced in §15). */
  effectivePrice: number | null;
}

/** The full PRICING table with overrides merged in - the admin page renders this. */
export async function getEffectivePricing(): Promise<EffectivePricingRow[]> {
  const overrides = await getPricingOverrides();
  const merged = mergedPricing(overrides);
  return Object.keys(PRICING).map((serviceKey) => ({
    serviceKey,
    entry: PRICING[serviceKey]!,
    override: overrides[serviceKey] ?? null,
    effectivePrice: merged[serviceKey]!.unit_price,
  }));
}

// ── Commission tiers ────────────────────────────────────────────────────────

function tierValidationError(tiers: CommissionTier[]): string | null {
  if (!Array.isArray(tiers) || tiers.length === 0) return "At least one tier is required";
  if (tiers.length > 20) return "Too many tiers";
  let previousThreshold = Number.POSITIVE_INFINITY;
  for (const tier of tiers) {
    const { minOnTimePercent, rate } = tier;
    if (
      !Number.isFinite(minOnTimePercent) ||
      minOnTimePercent < 0 ||
      minOnTimePercent > 100
    ) {
      return "Tier thresholds must be between 0 and 100";
    }
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      return "Tier rates must be between 0 and 100";
    }
    if (minOnTimePercent >= previousThreshold) {
      return "Tier thresholds must be strictly descending and unique";
    }
    previousThreshold = minOnTimePercent;
  }
  return null;
}

function isTierArray(raw: unknown): raw is CommissionTier[] {
  return (
    Array.isArray(raw) &&
    raw.every(
      (t) =>
        t != null &&
        typeof t === "object" &&
        typeof (t as CommissionTier).minOnTimePercent === "number" &&
        typeof (t as CommissionTier).rate === "number",
    )
  );
}

/** The configured tier table, or the HANDOFF §6.6 default when unset/invalid. */
export async function getCommissionTiers(): Promise<CommissionTier[]> {
  const raw = await readSetting(COMMISSION_TIERS_KEY);
  if (!isTierArray(raw) || tierValidationError(raw) != null) {
    return COMMISSION_TIERS.map((t) => ({ ...t }));
  }
  return raw.map((t) => ({ minOnTimePercent: t.minOnTimePercent, rate: t.rate }));
}

// ── Commission floor rate (below the lowest tier, and the no-data case) ─────

const COMMISSION_FLOOR_KEY = "commission_floor_rate";

/** The configured floor rate, or the HANDOFF §6.6 default (35) when unset. */
export async function getCommissionFloorRate(): Promise<number> {
  const raw = await readSetting(COMMISSION_FLOOR_KEY);
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 100) {
    return COMMISSION_FLOOR_RATE;
  }
  return raw;
}

/** Set the floor rate (0-100). Audit-logged with before/after. */
export async function setCommissionFloorRate(rate: number, actorId: number): Promise<number> {
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw new PricingConfigError(400, "The floor rate must be between 0 and 100");
  }
  const previous = await getCommissionFloorRate();
  const next = round2(rate);
  await writeSetting(COMMISSION_FLOOR_KEY, next, actorId);
  await logEvent({
    userId: actorId,
    action: "commission_floor_rate_updated",
    entityType: "app_settings",
    metadata: { key: COMMISSION_FLOOR_KEY, previousFloorRate: previous, newFloorRate: next },
  });
  return next;
}

/**
 * Replace the commission tier table. Validated: at least one tier,
 * thresholds strictly descending within 0-100, rates within 0-100. Audit-
 * logged with the full before/after table.
 */
export async function setCommissionTiers(
  tiers: CommissionTier[],
  actorId: number,
): Promise<CommissionTier[]> {
  const error = tierValidationError(tiers);
  if (error != null) throw new PricingConfigError(400, error);

  const previous = await getCommissionTiers();
  const next = tiers.map((t) => ({
    minOnTimePercent: round2(t.minOnTimePercent),
    rate: round2(t.rate),
  }));
  await writeSetting(COMMISSION_TIERS_KEY, next, actorId);
  await logEvent({
    userId: actorId,
    action: "commission_tiers_updated",
    entityType: "app_settings",
    metadata: { key: COMMISSION_TIERS_KEY, previousTiers: previous, newTiers: next },
  });
  return next;
}
