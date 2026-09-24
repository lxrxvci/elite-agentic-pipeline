import { eq } from "drizzle-orm";

import { db } from "@/db";
import { appSettings } from "@/db/schema";

/**
 * Feature flags (app_settings.feature_flags), read whole so flags added by
 * other surfaces survive merge-on-write. Each flag gets one typed reader with
 * its default spelled out at the read site.
 */
async function readFlags(): Promise<Record<string, unknown>> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, "feature_flags"))
    .limit(1);
  return (row?.value as Record<string, unknown> | undefined) ?? {};
}

/**
 * D4 variable-ratio celebrations: ON by default; the owner can quiet the
 * whole firm from /admin/settings (dopamine dosage rule 3 - opt-out always).
 */
export async function isCelebrationEnabled(): Promise<boolean> {
  const flags = await readFlags();
  return flags.celebrations_enabled !== false;
}

/**
 * Slack bridge (Phase 3C): OFF by default - posting internal notifications to
 * an external channel is an explicit admin decision (/admin/settings toggle).
 */
export async function isSlackEnabled(): Promise<boolean> {
  const flags = await readFlags();
  return flags.slack_enabled === true;
}
