import { eq } from "drizzle-orm";

import { db } from "@/db";
import { appSettings } from "@/db/schema";

import {
  bankFeedAlertsJob,
  deferredPushJob,
  dueSoonCheckJob,
  materializeJob,
  mentionEscalationJob,
  overdueCheckJob,
  recurringJob,
  resyncRecurringJob,
  staleCleanupJob,
  statementOverdueJob,
} from "./jobs";
import { firmLocalParts } from "./notifications";

/**
 * Background scheduler (HANDOFF §9).
 *
 * One process runs the loop (scripts/scheduler.ts for dev/self-host; Vercel
 * Cron hits /api/cron/[job] for the daily jobs - the 5-minute jobs are the
 * loop's, per §9). NEVER run two schedulers: the legacy systemd units that
 * double-fired every notification were deleted for exactly that reason, and
 * the loop takes a Postgres advisory lock so a second instance exits.
 *
 * runJob wraps every run: timing log, exception capture (Sentry seam), and
 * an app_settings `scheduler:last:{name}` stamp. A FAILED daily job does not
 * advance its stamp, so a transient blip retries on the next cycle instead
 * of silencing a whole day of notifications (§9).
 *
 * Startup (§9): generation jobs run once immediately; time-gated
 * notification jobs are seeded to "yesterday" so a 2 AM restart does not
 * blast alerts - they fire at their local hour on the next tick.
 */

export type JobName =
  | "recurring"
  | "materialize"
  | "resync-recurring"
  | "stale-cleanup"
  | "overdue-check"
  | "due-soon-check"
  | "bank-feed-alerts"
  | "statement-overdue"
  | "mention-sms"
  | "deferred-push";

export type JobSchedule =
  | { kind: "every_tick" } // the loop's 5-minute cadence
  | { kind: "daily"; hour: number; minute: number }; // firm-local

export interface JobDefinition {
  name: JobName;
  run: (now: Date) => Promise<unknown>;
  schedule: JobSchedule;
  /**
   * §9 startup behavior: generation jobs "run" once at boot; time-gated
   * notification jobs "seed_yesterday" so they wait for their local hour.
   */
  startup: "run" | "seed_yesterday";
}

/**
 * The §9 job table. Generation jobs run early morning (before the 7 AM
 * notification pass so alerts see fresh rows); the notification jobs fire
 * after 7:00/7:30 AM firm-local.
 */
export const JOB_SCHEDULE: readonly JobDefinition[] = [
  { name: "recurring", run: recurringJob, schedule: { kind: "daily", hour: 6, minute: 0 }, startup: "run" },
  { name: "materialize", run: materializeJob, schedule: { kind: "daily", hour: 6, minute: 5 }, startup: "run" },
  { name: "resync-recurring", run: resyncRecurringJob, schedule: { kind: "daily", hour: 6, minute: 10 }, startup: "run" },
  { name: "stale-cleanup", run: staleCleanupJob, schedule: { kind: "every_tick" }, startup: "run" },
  { name: "overdue-check", run: overdueCheckJob, schedule: { kind: "daily", hour: 7, minute: 0 }, startup: "seed_yesterday" },
  { name: "due-soon-check", run: dueSoonCheckJob, schedule: { kind: "daily", hour: 7, minute: 0 }, startup: "seed_yesterday" },
  { name: "bank-feed-alerts", run: bankFeedAlertsJob, schedule: { kind: "daily", hour: 7, minute: 0 }, startup: "seed_yesterday" },
  { name: "statement-overdue", run: statementOverdueJob, schedule: { kind: "daily", hour: 7, minute: 30 }, startup: "seed_yesterday" },
  { name: "mention-sms", run: mentionEscalationJob, schedule: { kind: "every_tick" }, startup: "run" },
  { name: "deferred-push", run: deferredPushJob, schedule: { kind: "every_tick" }, startup: "run" },
];

export function getJobDefinition(name: string): JobDefinition | undefined {
  return JOB_SCHEDULE.find((j) => j.name === name);
}

// ── Last-ran stamps (app_settings, §9) ────────────────────────────────────

const stampKey = (name: string) => `scheduler:last:${name}`;

export async function getLastRan(name: string): Promise<Date | null> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, stampKey(name)))
    .limit(1);
  const raw = row?.value;
  if (typeof raw !== "string") return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function setLastRan(name: string, at: Date): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: stampKey(name), value: at.toISOString() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: at.toISOString() } });
}

// ── runJob wrapper (§9) ───────────────────────────────────────────────────

export interface JobRunResult {
  name: string;
  ok: boolean;
  durationMs: number;
  report?: unknown;
  error?: string;
}

export async function runJob(
  name: string,
  fn: (now: Date) => Promise<unknown>,
  now: Date = new Date(),
): Promise<JobRunResult> {
  const startedAt = Date.now();
  try {
    const report = await fn(now);
    const durationMs = Date.now() - startedAt;
    // Only a successful run advances the stamp (§9: a failed daily job
    // retries on the next cycle rather than losing a whole day).
    await setLastRan(name, now);
    console.log(`[scheduler] ${name} ok in ${durationMs}ms`);
    return { name, ok: true, durationMs, report };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    // SENTRY SEAM (§9 "optionally reports to Sentry"): captureException(err)
    // goes here when an SDK is added; until then the job log is the record.
    console.error(`[scheduler] ${name} FAILED in ${durationMs}ms:`, err);
    return { name, ok: false, durationMs, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Due decisions ─────────────────────────────────────────────────────────

function sameFirmLocalDay(a: Date, b: Date): boolean {
  const pa = firmLocalParts(a);
  const pb = firmLocalParts(b);
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
}

/**
 * Pure due test for daily jobs (unit-testable): due when firm-local `now`
 * is at/past the scheduled hour AND the last successful run was on a
 * different firm-local day (or never ran).
 */
export function dailyJobDue(
  schedule: { hour: number; minute: number },
  lastRan: Date | null,
  now: Date,
): boolean {
  const p = firmLocalParts(now);
  if (p.hour * 60 + p.minute < schedule.hour * 60 + schedule.minute) return false;
  if (lastRan == null) return true;
  return !sameFirmLocalDay(lastRan, now);
}

/**
 * One scheduler pass (§9): every-tick jobs run every pass; daily jobs run
 * once per firm-local day after their hour. Jobs are independent - runJob
 * captures each failure, so one bad job never blocks the rest of the tick.
 */
export async function schedulerTick(now: Date = new Date()): Promise<JobRunResult[]> {
  const results: JobRunResult[] = [];
  for (const def of JOB_SCHEDULE) {
    if (def.schedule.kind === "every_tick") {
      results.push(await runJob(def.name, def.run, now));
      continue;
    }
    const lastRan = await getLastRan(def.name);
    if (lastRan == null) {
      // No stamp at all: seed to "yesterday" rather than firing now (§9 -
      // startup behavior for time-gated jobs; the hour gate above still
      // applies on the next tick).
      const yesterday = new Date(now.getTime() - 24 * 60 * 60_000);
      await setLastRan(def.name, yesterday);
      continue;
    }
    if (!dailyJobDue(def.schedule, lastRan, now)) continue;
    results.push(await runJob(def.name, def.run, now));
  }
  return results;
}

/**
 * §9 startup: run the generation jobs once immediately (recurring,
 * materialize, resync-recurring, stale-cleanup, mention-sms, deferred-push)
 * and seed the time-gated notification jobs to "yesterday" so a 2 AM
 * restart does not blast alerts. Existing stamps are never clobbered.
 */
export async function startupRun(now: Date = new Date()): Promise<JobRunResult[]> {
  const results: JobRunResult[] = [];
  for (const def of JOB_SCHEDULE) {
    if (def.startup === "run") {
      results.push(await runJob(def.name, def.run, now));
      continue;
    }
    if ((await getLastRan(def.name)) == null) {
      await setLastRan(def.name, new Date(now.getTime() - 24 * 60 * 60_000));
    }
  }
  return results;
}
