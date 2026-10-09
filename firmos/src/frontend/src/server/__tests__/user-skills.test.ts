import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { auditEvents, users } from "@/db/schema";
import { seedDatabase } from "@/server/seed";
import { listUserSkills, setUserSkill, UserSkillError } from "@/server/user-skills";

import { TEST_TODAY, dbReachable } from "./helpers";

const reachable = await dbReachable();

/**
 * L6 (I6, 10_06 00:51:01): the skill-tree store - manual levels per user x
 * tier, admin-set and audited, ready for the later recommender read.
 */
describe.skipIf(!reachable)("user_skills (L6/I6)", () => {
  let danaId: number;

  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    const [dana] = await db.select().from(users).where(eq(users.email, "dana@blueledgerbooks.com")).limit(1);
    danaId = dana.id;
  });

  it("skill_rows_seed_manually: upsert, read-back, re-level, audit", async () => {
    await setUserSkill(danaId, "bookkeeper", 4, danaId);
    await setUserSkill(danaId, "manager", 2, danaId);

    let rows = await listUserSkills();
    const danaRows = rows.filter((r) => r.userId === danaId);
    expect(danaRows).toEqual([
      { userId: danaId, userName: expect.any(String), tier: "bookkeeper", level: 4 },
      { userId: danaId, userName: expect.any(String), tier: "manager", level: 2 },
    ]);

    // Same cell re-levels in place (one row per user x tier).
    await setUserSkill(danaId, "bookkeeper", 5, danaId);
    rows = await listUserSkills();
    expect(rows.filter((r) => r.userId === danaId && r.tier === "bookkeeper")).toHaveLength(1);
    expect(rows.find((r) => r.userId === danaId && r.tier === "bookkeeper")?.level).toBe(5);

    const audit = await db.select().from(auditEvents).where(eq(auditEvents.entityType, "user_skill"));
    expect(audit.filter((e) => e.action === "user_skill_set").length).toBeGreaterThanOrEqual(3);
  });

  it("rejects unknown tiers and out-of-range levels", async () => {
    await expect(setUserSkill(danaId, "wizard", 3, danaId)).rejects.toThrow(UserSkillError);
    await expect(setUserSkill(danaId, "bookkeeper", 0, danaId)).rejects.toThrow(/1 to 5/);
    await expect(setUserSkill(danaId, "bookkeeper", 6, danaId)).rejects.toThrow(/1 to 5/);
    await expect(setUserSkill(999999, "bookkeeper", 3, danaId)).rejects.toThrow(/Unknown user/);
  });
});
