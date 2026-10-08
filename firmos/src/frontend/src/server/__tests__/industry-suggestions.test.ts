import { describe, expect, it } from "vitest";

import { addIndustrySuggestion, listIndustrySuggestions } from "@/server/industry-suggestions";

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

    // Surfaces for the matching industry (fold-insensitive)...
    const hit = await listIndustrySuggestions("medical therapy practice");
    expect(hit.some((s) => s.serviceKey === key)).toBe(true);
    // ...and never for a different industry.
    const miss = await listIndustrySuggestions("construction");
    expect(miss.some((s) => s.serviceKey === key)).toBe(false);

    // Re-tagging the same industry+key dedupes (no second row).
    const again = await addIndustrySuggestion("  MEDICAL / THERAPY PRACTICE  ", key, "A custom add-on from a prior intake.");
    expect(again?.id).toBe(row!.id);
  });
});
