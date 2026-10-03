import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { industrySuggestions, servicesCatalog } from "@/db/schema";
import { normalizeInstitutionKey } from "@/shared/lib/institution-key";

/**
 * K6 (D2, 09_30 00:44:51): industry-driven suggested add-ons. Selecting an
 * industry early in the intake references this table on the services screen;
 * suggestions render with their read-aloud explainer and ONLY a click adds
 * them ("as long as it's suggestive and not generative, then I can do that").
 */

export interface IndustrySuggestionRow {
  id: number;
  industryKey: string;
  serviceKey: string;
  explainer: string;
}

const SEEDS: Array<Omit<IndustrySuggestionRow, "id">> = [
  {
    industryKey: "medical / therapy practice",
    serviceKey: "additional_therapist_tracking",
    explainer:
      "Therapy practices need each insurance payout broken down per practitioner (the EOB work) - we charge $100 per therapist per month for it.",
  },
  {
    industryKey: "construction",
    serviceKey: "job_costing",
    explainer:
      "Construction clients track income and expenses per job (a pool build, a remodel) - we produce a profit and loss per project.",
  },
];

export async function seedIndustrySuggestions(): Promise<number> {
  const existing = await db.select().from(industrySuggestions);
  const have = new Set(existing.map((r) => `${r.industryKey}:${r.serviceKey}`));
  const missing = SEEDS.filter((s) => !have.has(`${s.industryKey}:${s.serviceKey}`));
  if (missing.length === 0) return 0;
  await db.insert(industrySuggestions).values(missing);
  return missing.length;
}

/** Active suggestions for one intake industry answer (fold-matched). */
export async function listIndustrySuggestions(industry: string | null | undefined): Promise<IndustrySuggestionRow[]> {
  const key = normalizeInstitutionKey(industry);
  if (key == null) return [];
  const rows = await db
    .select()
    .from(industrySuggestions)
    .where(and(eq(industrySuggestions.isActive, true)))
    .orderBy(asc(industrySuggestions.position), asc(industrySuggestions.id));
  return rows
    .filter((r) => normalizeInstitutionKey(r.industryKey) === key)
    .map((r) => ({ id: r.id, industryKey: r.industryKey, serviceKey: r.serviceKey, explainer: r.explainer }));
}

/** Job costing exists as an unpriced catalog custom add-on (D2's example). */
export async function seedJobCostingService(): Promise<void> {
  const existing = await db
    .select({ id: servicesCatalog.id })
    .from(servicesCatalog)
    .where(eq(servicesCatalog.serviceKey, "job_costing"))
    .limit(1);
  if (existing.length > 0) return;
  await db.insert(servicesCatalog).values({
    serviceKey: "job_costing",
    productName: "Job costing",
    group: "tracking",
    unit: "month",
    unitPrice: null, // J14: quoted at review, never guessed
    scaling: "flat_monthly",
    bucket: "monthly",
    isStandard: false,
    isAddon: true,
    isActive: true,
  });
}
