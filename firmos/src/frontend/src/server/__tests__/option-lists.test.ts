import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { auditEvents, optionListValues } from "@/db/schema";
import {
  addOptionValue,
  listOptionValues,
  OPTION_LISTS,
  OptionListError,
  renameOptionValue,
  seedOptionLists,
  setOptionValueActive,
} from "@/server/option-lists";
import { seedDatabase } from "@/server/seed";

import { dbReachable, TEST_TODAY } from "./helpers";

/**
 * K3 (DB1/J1/J2/J3/J16): the universal persistent-option engine - the
 * institutions semantics (dedupe, alphabetization, admin management) for
 * EVERY reusable list behind one registry.
 */

const reachable = await dbReachable();

describe.skipIf(!reachable)("option-lists engine", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
  });

  it("all_option_lists_alphabetized: every registered list seeds and reads back alphabetized (J3)", async () => {
    await seedOptionLists();
    for (const def of Object.values(OPTION_LISTS)) {
      const names = (await listOptionValues(def.key)).map((v) => v.name);
      for (const seed of def.seeds) expect(names).toContain(seed);
      const human = [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      expect(names).toEqual(human);
    }
  });

  it("every_add_new_persists_globally + case_fold_dupe_returns_existing_row (J1)", async () => {
    const created = await addOptionValue("referral_sources", "  Chamber of   Commerce ", 1);
    expect(created.name).toBe("Chamber of Commerce");

    // Same name, different case/whitespace: the existing row comes back.
    const dupe = await addOptionValue("referral_sources", "chamber of commerce");
    expect(dupe.id).toBe(created.id);
    const names = (await listOptionValues("referral_sources")).map((v) => v.name);
    expect(names.filter((n) => n === "Chamber of Commerce")).toHaveLength(1);

    // And it persists for future reads (the whole point of DB1).
    expect(names).toContain("Chamber of Commerce");
    await expect(addOptionValue("referral_sources", "   ")).rejects.toBeInstanceOf(OptionListError);
    await expect(addOptionValue("nope_list", "x")).rejects.toBeInstanceOf(OptionListError);
  });

  it("custom_answer_never_stranded: an intake-style custom joins the list (J2)", async () => {
    // The wizard's custom-"Other" path calls the same add the admin uses.
    await addOptionValue("industries", "Hot air balloon repair");
    const names = (await listOptionValues("industries")).map((v) => v.name);
    expect(names).toContain("Hot air balloon repair");
  });

  it("lists_admin_manageable: rename, deactivate, reactivate - all audited (J16)", async () => {
    const added = await addOptionValue("payment_methods", "Zelle");
    const renamed = await renameOptionValue("payment_methods", added.id, "Zelle / Venmo", 1);
    expect(renamed.name).toBe("Zelle / Venmo");
    // Rename refuses to collide with an existing value.
    await expect(renameOptionValue("payment_methods", added.id, "cash", 1)).rejects.toThrow(/already on the list/);

    await setOptionValueActive("payment_methods", added.id, false, 1);
    let names = (await listOptionValues("payment_methods")).map((v) => v.name);
    expect(names).not.toContain("Zelle / Venmo");
    // Inactive rows still exist (history preserved), just not offered.
    names = (await listOptionValues("payment_methods", true)).map((v) => v.name);
    expect(names).toContain("Zelle / Venmo");

    // Re-adding a hidden value brings it back instead of forking.
    const back = await addOptionValue("payment_methods", "zelle / venmo");
    expect(back.id).toBe(added.id);
    expect(back.isActive).toBe(true);

    const audit = await db.select().from(auditEvents).where(eq(auditEvents.entityType, "option_list"));
    const actions = audit.map((e) => e.action);
    expect(actions).toContain("option_value_added");
    expect(actions).toContain("option_value_renamed");
    expect(actions).toContain("option_value_deactivated");
  });
});

describe("extraction parity (K3)", () => {
  it("extraction_vocab_matches_live_lists: a list-added custom coerces instead of rejecting", async () => {
    const { coerceExtraction } = await import("@/server/intake-extract");
    const raw = {
      fields: [
        { key: "referralSource", value: "Chamber of Commerce", confidence: 0.9, evidence: "met at the chamber" },
      ],
      suggestedLegalName: "Test Co",
    };
    // Off-vocabulary without the merge: rejected.
    const without = coerceExtraction(raw);
    expect(without.fields.find((f) => f.key === "referralSource")).toBeUndefined();
    // With the live list merged: accepted.
    const withLive = coerceExtraction(raw, { referralSource: ["Chamber of Commerce"] });
    expect(withLive.fields.find((f) => f.key === "referralSource")?.value).toBe("Chamber of Commerce");
  });
});

describe("L2/B5: roles_seed_cpa_owner_secondary (10_06 00:03:57)", () => {
  it("contact_roles seeds CPA, business owner, and secondary contact", () => {
    const seeds = OPTION_LISTS.contact_roles.seeds;
    expect(seeds).toContain("CPA");
    expect(seeds).toContain("Business owner");
    expect(seeds).toContain("Secondary contact");
    expect(seeds).toContain("Primary contact");
  });

  it("payroll_services seeds the three canonical services (L2/D3)", () => {
    const seeds = OPTION_LISTS.payroll_services.seeds;
    expect(seeds).toEqual(["Quarterly filings", "State and local payments", "Hours and commission calculations"]);
  });
});
