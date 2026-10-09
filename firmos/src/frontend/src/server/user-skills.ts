import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { users, userSkills } from "@/db/schema";
import { logEvent } from "@/server/audit";
import { SKILL_TIERS, type SkillTier, type UserSkillRow } from "@/shared/lib/user-skills";

/**
 * L6 (I6, 10_06 00:51:01): the skill-tree store - manual 1-5 levels per
 * staff user per difficulty tier (the L3 rate tiers). Admin/owner set them;
 * the later workload/skill recommender reads them. No auto-assignment yet.
 *
 * The tier constants and row type live in shared/lib/user-skills (client
 * components import them from there - this module carries the db).
 */

export { SKILL_TIERS, type SkillTier, type UserSkillRow };

export class UserSkillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserSkillError";
  }
}

/** Every staff user's skill rows, user-then-tier ordered. */
export async function listUserSkills(): Promise<UserSkillRow[]> {
  const rows = await db
    .select({
      userId: userSkills.userId,
      tier: userSkills.tier,
      level: userSkills.level,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(userSkills)
    .innerJoin(users, eq(users.id, userSkills.userId))
    .orderBy(asc(users.firstName), asc(userSkills.tier));
  return rows.map((r) => ({
    userId: r.userId,
    userName: `${r.firstName} ${r.lastName}`.trim(),
    tier: r.tier as SkillTier,
    level: r.level,
  }));
}

/** Upsert one user x tier level (audited). Level is 1-5; tier is one of the
 *  L3 difficulty tiers. */
export async function setUserSkill(
  userId: number,
  tier: string,
  level: number,
  actorId: number,
): Promise<void> {
  if (!SKILL_TIERS.includes(tier as SkillTier)) {
    throw new UserSkillError(`Unknown skill tier "${tier}" - expected ${SKILL_TIERS.join(", ")}.`);
  }
  if (!Number.isInteger(level) || level < 1 || level > 5) {
    throw new UserSkillError("Skill level is a whole number from 1 to 5.");
  }
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new UserSkillError(`Unknown user ${userId}.`);

  await db
    .insert(userSkills)
    .values({ userId, tier, level, updatedById: actorId })
    .onConflictDoUpdate({
      target: [userSkills.userId, userSkills.tier],
      set: { level, updatedById: actorId, updatedAt: new Date() },
    });
  await logEvent({
    userId: actorId,
    action: "user_skill_set",
    entityType: "user_skill",
    entityId: null,
    metadata: { skillUserId: userId, tier, level },
  });
}
