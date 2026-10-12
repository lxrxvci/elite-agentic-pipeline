import { describe, expect, it } from "vitest";

import {
  addIndustrySuggestion,
  canonicalIndustryKey,
  listIndustrySuggestions,
} from "@/server/industry-suggestions";
import { listServicesCatalog } from "@/server/services-catalog";

import { dbReachable } from "./helpers";

/**
 * L2 (H7, 10_06 00:38:20): industry-tagged custom add-ons join the
 * suggestion engine - fold-deduped, and they surface ONLY for the matching
 * industry ("tagged → only shows when that industry is selected").
 */

const reachable = await dbReachable();

describe.skipIf(!reachable)("industry-tagged custom add-ons (L2/H7)", () => {
  it("a tagged custom surfaces only for its industry; re-tag dedupes", async () => {
    const key = `custom:L2 smoke ${Date.now()}`;
    const row = await addIndustrySuggestion("Medical / therapy practice", key, "A custom add-on from a prior intake.");
    expect(row).toBeTruthy();

    // Surfaces for the matching industry (the wizard passes the industry
    // answer verbatim from the industries list; the fold matches it)...
    const hit = await listIndustrySuggestions("Medical / therapy practice");
    expect(hit.some((s) => s.serviceKey === key)).toBe(true);
    // ...and never for a different industry.
    const miss = await listIndustrySuggestions("construction");
    expect(miss.some((s) => s.serviceKey === key)).toBe(false);

    // Re-tagging the same industry+key dedupes (no second row).
    const again = await addIndustrySuggestion("  MEDICAL / THERAPY PRACTICE  ", key, "A custom add-on from a prior intake.");
    expect(again?.id).toBe(row!.id);
  });
});

// M1 (B5, 10_10 00:22:32): "let's just have it create the therapist and
// consulting industry… and put additional therapist tracking to that
// industry as an industry specific thing or remove it from this common
// one." Both halves: scoped suggestion, out of the common add-ons.
describe.skipIf(!reachable)("M1/B5: therapist_tracking_scopes_to_therapy_industry", () => {
  it("therapy/counseling spellings fold to the seeded industry and surface the tracking suggestion", () => {
    expect(canonicalIndustryKey("Therapist")).toBe("medical / therapy practice");
    expect(canonicalIndustryKey("Counseling and therapy")).toBe("medical / therapy practice");
    expect(canonicalIndustryKey("Construction")).toBe("construction");
  });

  it("the seeded suggestion returns for therapist variants, never for other industries", async () => {
    for (const industry of ["Therapist", "therapy", "Counseling", "Counseling and therapy"]) {
      const hit = await listIndustrySuggestions(industry);
      expect(hit.some((s) => s.serviceKey === "additional_therapist_tracking")).toBe(true);
    }
    const miss = await listIndustrySuggestions("Restaurant / food service");
    expect(miss.some((s) => s.serviceKey === "additional_therapist_tracking")).toBe(false);
  });

  it("it is no longer a common add-on in the services catalog", async () => {
    const rows = await listServicesCatalog();
    const row = rows.find((r) => r.serviceKey === "additional_therapist_tracking");
    expect(row).toBeTruthy();
    expect(row!.isAddon).toBe(false);
  });
});
