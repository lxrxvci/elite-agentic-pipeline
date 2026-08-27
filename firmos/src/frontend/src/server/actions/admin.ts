"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import type { PayoutConfig } from "@firmos/domain";

import { db } from "@/db";
import { appSettings, feedback, users } from "@/db/schema";
import { logEvent } from "@/server/audit";
import { requireRole, requireStaff, USER_ROLES, type SessionUser } from "@/server/auth/guards";
import { setPayoutConfig } from "@/server/payroll";

/**
 * Admin console server actions (HANDOFF §11, §16, §27).
 *
 * Every mutation is requireRole("admin", "owner")-gated and audit-logged
 * through audit.logEvent. Role VALUES are normalized to lowercase here (both
 * casings exist in production data, §11) so guards always compare the
 * canonical form. Feedback submission is the exception: any staff member can
 * file feedback (§16), and it is not an admin surface.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : "Something went wrong - try again.";
  return { ok: false, error: message };
}

async function requireAdmin(): Promise<SessionUser> {
  return requireRole("admin", "owner");
}

// ── Users (§11) ───────────────────────────────────────────────────────────

export interface StaffUserPatch {
  role?: string;
  isActive?: boolean;
  baseHourlyPay?: string | null;
  commissionRateOverride?: string | null;
  idleTimeoutMinutes?: number;
  managerId?: number | null;
  canAccessStatements?: boolean;
  canEditTaskTemplates?: boolean;
  canEditSops?: boolean;
  canEditTaxTemplates?: boolean;
}

/** Money columns are numeric(12,2) / numeric(6,2); null clears the override. */
function parseMoney(value: string | null, field: string): string | null {
  if (value == null || value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 999999) {
    throw new Error(`${field} must be a number between 0 and 999999`);
  }
  return n.toFixed(2);
}

/**
 * Apply an admin edit to a staff user. Role changes are normalized to
 * lowercase and restricted to the staff roles assignable from this surface
 * (portal roles are provisioned, never assigned). An admin cannot demote or
 * deactivate their own account - that path always ends in a lockout.
 */
export async function updateStaffUserAction(
  userId: number,
  patch: StaffUserPatch,
): Promise<ActionResult<{ updated: true }>> {
  try {
    const actor = await requireAdmin();
    const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!target) throw new Error(`User ${userId} not found`);

    const set: Partial<typeof users.$inferInsert> = {};
    const changed: Record<string, unknown> = {};

    if (patch.role !== undefined) {
      if (actor.id === userId) throw new Error("You cannot change your own role");
      const role = patch.role.toLowerCase();
      if (!USER_ROLES.includes(role as (typeof USER_ROLES)[number])) {
        throw new Error(`Unknown role: ${patch.role}`);
      }
      if (role === "client" || role === "cpa") {
        throw new Error("Portal roles are provisioned through the portal, not assigned here");
      }
      set.role = role as typeof target.role;
      changed.role = role;
    }
    if (patch.isActive !== undefined) {
      if (actor.id === userId && patch.isActive === false) {
        throw new Error("You cannot deactivate your own account");
      }
      set.isActive = patch.isActive;
      changed.isActive = patch.isActive;
    }
    if (patch.baseHourlyPay !== undefined) {
      const v = parseMoney(patch.baseHourlyPay, "Hourly pay");
      set.baseHourlyPay = v;
      changed.baseHourlyPay = v;
    }
    if (patch.commissionRateOverride !== undefined) {
      const v = parseMoney(patch.commissionRateOverride, "Commission override");
      set.commissionRateOverride = v;
      changed.commissionRateOverride = v;
    }
    if (patch.idleTimeoutMinutes !== undefined) {
      const n = Math.round(patch.idleTimeoutMinutes);
      if (!Number.isFinite(n) || n < 1 || n > 480) {
        throw new Error("Idle timeout must be between 1 and 480 minutes");
      }
      set.idleTimeoutMinutes = n;
      changed.idleTimeoutMinutes = n;
    }
    if (patch.managerId !== undefined) {
      if (patch.managerId === userId) throw new Error("A user cannot manage themselves");
      set.managerId = patch.managerId;
      changed.managerId = patch.managerId;
    }
    for (const flag of [
      "canAccessStatements",
      "canEditTaskTemplates",
      "canEditSops",
      "canEditTaxTemplates",
    ] as const) {
      if (patch[flag] !== undefined) {
        set[flag] = patch[flag];
        changed[flag] = patch[flag];
      }
    }

    if (Object.keys(set).length === 0) throw new Error("Nothing to update");

    set.updatedAt = new Date();
    await db.update(users).set(set).where(eq(users.id, userId));
    await logEvent({
      userId: actor.id,
      action: "admin_user_updated",
      entityType: "user",
      entityId: userId,
      metadata: { changed },
    });
    revalidatePath("/admin/users");
    return { ok: true, data: { updated: true } };
  } catch (error) {
    return fail(error);
  }
}

// ── Settings (§27) ────────────────────────────────────────────────────────

export interface AdminSettingsPatch {
  orgName?: string;
  purgeEnabled?: boolean;
  clientPortalEnabled?: boolean;
  maxClockInHours?: number;
  commissionPayout?: PayoutConfig;
}

const PAYOUT_VALUES: readonly PayoutConfig[] = [
  "next_month_first",
  "next_month_second",
  "same_month_second",
];

async function upsertSetting(key: string, value: unknown, actorId: number): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value, updatedById: actorId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedById: actorId, updatedAt: new Date() },
    });
}

/**
 * Persist the /admin/settings form. feature_flags is merged (read-modify-
 * write) so flags this surface does not expose survive the save. Every saved
 * field is audit-logged in one event with the before/after payload.
 */
export async function updateAdminSettingsAction(
  patch: AdminSettingsPatch,
): Promise<ActionResult<{ saved: true }>> {
  try {
    const actor = await requireAdmin();
    const changed: Record<string, unknown> = {};

    if (patch.orgName !== undefined) {
      const name = patch.orgName.trim();
      if (name.length === 0) throw new Error("Organization name cannot be empty");
      if (name.length > 120) throw new Error("Organization name is too long");
      await upsertSetting("org_profile", { name }, actor.id);
      changed.orgName = name;
    }

    if (patch.purgeEnabled !== undefined || patch.clientPortalEnabled !== undefined) {
      const [row] = await db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, "feature_flags"))
        .limit(1);
      const current = (row?.value as Record<string, unknown> | undefined) ?? {};
      const next = {
        ...current,
        ...(patch.purgeEnabled !== undefined ? { purge_enabled: patch.purgeEnabled } : {}),
        ...(patch.clientPortalEnabled !== undefined
          ? { client_portal_enabled: patch.clientPortalEnabled }
          : {}),
      };
      await upsertSetting("feature_flags", next, actor.id);
      changed.featureFlags = next;
    }

    if (patch.maxClockInHours !== undefined) {
      const n = patch.maxClockInHours;
      if (!Number.isFinite(n) || n < 1 || n > 24) {
        throw new Error("Max clock-in hours must be between 1 and 24");
      }
      await upsertSetting("max_clock_in_hours", n, actor.id);
      changed.maxClockInHours = n;
    }

    if (patch.commissionPayout !== undefined) {
      if (!PAYOUT_VALUES.includes(patch.commissionPayout)) {
        throw new Error(`Unknown payout cadence: ${patch.commissionPayout}`);
      }
      await setPayoutConfig({ commission_payout: patch.commissionPayout }, actor.id);
      changed.commissionPayout = patch.commissionPayout;
    }

    if (Object.keys(changed).length === 0) throw new Error("Nothing to save");

    await logEvent({
      userId: actor.id,
      action: "admin_settings_updated",
      entityType: "app_settings",
      metadata: { changed },
    });
    revalidatePath("/admin/settings");
    return { ok: true, data: { saved: true } };
  } catch (error) {
    return fail(error);
  }
}

// ── Feedback (§16) ────────────────────────────────────────────────────────

const FEEDBACK_CATEGORIES = ["bug", "feature", "other"] as const;
const FEEDBACK_STATUSES = ["pending", "reviewed", "addressed"] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** Any staff member files feedback from the top-bar widget (§16). */
export async function submitFeedbackAction(input: {
  category: FeedbackCategory;
  message: string;
  pageUrl?: string | null;
}): Promise<ActionResult<{ id: number }>> {
  try {
    const user = await requireStaff();
    if (!FEEDBACK_CATEGORIES.includes(input.category)) {
      throw new Error(`Unknown feedback category: ${input.category}`);
    }
    const message = input.message.trim();
    if (message.length < 3) throw new Error("Tell us a little more - the message is too short");
    if (message.length > 5000) throw new Error("Message is too long");

    const [row] = await db
      .insert(feedback)
      .values({ userId: user.id, category: input.category, message, pageUrl: input.pageUrl ?? null })
      .returning({ id: feedback.id });
    return { ok: true, data: { id: row.id } };
  } catch (error) {
    return fail(error);
  }
}

/** Admin/owner moves a feedback row along pending -> reviewed -> addressed. */
export async function updateFeedbackStatusAction(
  feedbackId: number,
  status: FeedbackStatus,
): Promise<ActionResult<{ status: FeedbackStatus }>> {
  try {
    const actor = await requireAdmin();
    if (!FEEDBACK_STATUSES.includes(status)) throw new Error(`Unknown status: ${status}`);
    const [row] = await db
      .update(feedback)
      .set({ status, updatedAt: new Date() })
      .where(eq(feedback.id, feedbackId))
      .returning({ id: feedback.id });
    if (!row) throw new Error(`Feedback ${feedbackId} not found`);
    await logEvent({
      userId: actor.id,
      action: "feedback_status_updated",
      entityType: "feedback",
      entityId: feedbackId,
      metadata: { status },
    });
    revalidatePath("/admin/feedback");
    return { ok: true, data: { status } };
  } catch (error) {
    return fail(error);
  }
}
