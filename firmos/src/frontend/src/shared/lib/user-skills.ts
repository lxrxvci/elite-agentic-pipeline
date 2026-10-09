/**
 * L6 (I6, 10_06 00:51:01): the skill-trees constants shared by the server
 * store (server/user-skills.ts) and the admin editor (client-side) - kept
 * db-free so the client bundle never imports the server module.
 */

export const SKILL_TIERS = ["bookkeeper", "manager", "owner"] as const;
export type SkillTier = (typeof SKILL_TIERS)[number];

export interface UserSkillRow {
  userId: number;
  userName: string;
  tier: SkillTier;
  level: number;
}
