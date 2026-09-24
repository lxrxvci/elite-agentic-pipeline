import { and, eq, gte, inArray, isNull, lt, lte } from "drizzle-orm";

import { addDays, formatLocalDate, type LocalDate } from "@firmos/domain";

import { db } from "@/db";
import { notifications, tasks, users, workstationTimeEntries } from "@/db/schema";

import {
  computeMissingInfoReminders,
  sendMissingInfoReminder,
} from "./correspondence";
import { materializeOperationalRows, type MaterializeSummary } from "./materialize";
import {
  emitOncePer24Hours,
  emitOncePerDay,
  firmLocalParts,
  firmLocalToday,
  getApprovedWorkingHours,
  isInsideWorkingHours,
  scheduleWindowForWeekday,
  IMMEDIATE_PUSH_TYPES,
} from "./notifications";
import { sendPushToUser } from "./push";
import { getUnifiedQueue, type WorkCard } from "./queue";
import { runRecurringOnce, backfillRecurringInstanceSubtasks, type RecurringSummary } from "./recurring";
import { getStatementQueue } from "./statements";
import { runStaleCleanup, type StaleCleanupResult } from "./time-tracking";
import { computeW9ReminderPlans, sendW9Reminder } from "./w9";

/**
 * Background jobs (HANDOFF §9). One job function per §9 table row; the
 * scheduler (scheduler.ts) owns WHEN they run, this module owns WHAT.
 *
 * Every job takes an injected `now` and derives firm-local today from it
 * (FIRMOS_TIMEZONE, §30 conv. 4 - nothing here touches the bare clock).
 * Per-entity error isolation (§9): notification loops try/catch each item
 * and collect failures into the summary instead of aborting the batch.
 *
 * Dedup (§9):
 *  - the 7 AM jobs emit through emitOncePerDay - one per
 *    (user, type, entity, firm-local calendar day);
 *  - statement-overdue emits through emitOncePer24Hours per account;
 *  - mention-sms is rate-limited to one SMS per user per 15 minutes;
 *  - deferred-push selects only unread, unsent rows created within 18h.
 */

const MS_PER_MINUTE = 60_000;

/** §16 mention SMS: 15-minute age threshold + 15-minute per-user rate limit. */
export const MENTION_SMS_AGE_MS = 15 * MS_PER_MINUTE;
export const MENTION_SMS_RATE_LIMIT_MS = 15 * MS_PER_MINUTE;

/** §9 deferred-push: unread, unsent, created within 18 hours. */
export const DEFERRED_PUSH_LOOKBACK_MS = 18 * 60 * MS_PER_MINUTE;

/** §16 mention types that escalate to SMS (chat + task-note mentions). */
const MENTION_TYPES = ["chat_mention", "task_note_mention"] as const;

const ENTITY_TYPE_BY_KIND: Record<WorkCard["kind"], string> = {
  task: "task",
  bank_feed: "weekly_bank_feed",
  reconciliation: "account_reconciliation",
  report: "client_report",
};

/** §31 - notification links land on the surface staff actually use. Tasks
 * have no dedicated route (their detail opens in the Workstation drawer),
 * so every work-card kind links to /workstation. */
const WORK_CARD_LINK = "/workstation";

export interface EntityFailure {
  entityType: string;
  entityId: number;
  error: string;
}

// ── recurring (§9: once per firm-local day; startup + daily) ──────────────

export interface RecurringJobSummary {
  recurring: RecurringSummary;
  /** §9 - run_recurring also purges trash older than 30 days. */
  trashPurged: number;
  /** 2B-1 - current-year instances repaired with their rule's checklist. */
  instanceSubtasksCreated: number;
}

export async function recurringJob(now: Date = new Date()): Promise<RecurringJobSummary> {
  const today = firmLocalToday(now);
  const recurring = await runRecurringOnce(today);

  // 2B-1 - after generation, backfill the checklists of current-year
  // instances that predate the materialization copy (idempotent).
  const backfill = await backfillRecurringInstanceSubtasks(today);

  // §9 - trash purge: soft-deleted tasks whose deleted_at is 30+ days old.
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * MS_PER_MINUTE);
  const purged = await db
    .delete(tasks)
    .where(lt(tasks.deletedAt, cutoff))
    .returning({ id: tasks.id });

  return { recurring, trashPurged: purged.length, instanceSubtasksCreated: backfill.subtasksCreated };
}

// ── materialize (§9: once per day, after recurring) ───────────────────────

export async function materializeJob(now: Date = new Date()): Promise<MaterializeSummary> {
  // Per-client try/catch isolation lives inside materializeOperationalRows.
  return materializeOperationalRows(firmLocalToday(now));
}

// ── resync-recurring (§9: once per day, after materialize) ────────────────

export interface ResyncRecurringSummary {
  skipped: boolean;
  reason: string | null;
}

export async function resyncRecurringJob(now: Date = new Date()): Promise<ResyncRecurringSummary> {
  void now;
  // §9 resync-recurring repairs assignees/dates/statuses on materialized
  // instances. No resync module exists in the port yet (the legacy
  // resync_recurring.py has no counterpart under src/server); report the
  // skip instead of silently doing nothing.
  return {
    skipped: true,
    reason:
      "resync-recurring is not ported yet - materialized-instance repair " +
      "(assignees, dates, statuses) lands with the recurring-maintenance wave",
  };
}

// ── overdue / due-soon / bank-feed alerts (§9: daily after 7:00 AM local) ─

export interface NotifyJobSummary {
  today: string;
  candidates: number;
  notificationsSent: number;
  failures: EntityFailure[];
}

async function notifyAssignees(
  cards: WorkCard[],
  type: "task_overdue" | "task_due_soon",
  today: LocalDate,
  now: Date,
): Promise<NotifyJobSummary> {
  const summary: NotifyJobSummary = {
    today: formatLocalDate(today),
    candidates: cards.length,
    notificationsSent: 0,
    failures: [],
  };
  for (const card of cards) {
    if (card.assigneeId == null) continue;
    try {
      const verb = type === "task_overdue" ? "Overdue" : "Due soon";
      const written = await emitOncePerDay(
        {
          userId: card.assigneeId,
          type,
          title: `${verb}: ${card.title}`,
          message: `${card.clientName} - due ${card.dueDate ?? "unscheduled"}`,
          link: WORK_CARD_LINK,
          entityType: ENTITY_TYPE_BY_KIND[card.kind],
          entityId: card.id,
        },
        now,
      );
      if (written) summary.notificationsSent += 1;
    } catch (err) {
      // §9 - per-entity isolation: one bad card cannot abort the batch.
      summary.failures.push({
        entityType: ENTITY_TYPE_BY_KIND[card.kind],
        entityId: card.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return summary;
}

/**
 * §9 overdue-check: overdue tasks, reconciliations, and reports to their
 * assignees. Bank feeds are bank-feed-alerts' lane (below). The queue's
 * bucketing already excludes waiting/deferred/gated rows (§5, §29).
 */
export async function overdueCheckJob(now: Date = new Date()): Promise<NotifyJobSummary> {
  const today = firmLocalToday(now);
  const queue = await getUnifiedQueue(0, today);
  const cards = queue.buckets.overdue.filter(
    (c) => c.assigneeId != null && c.kind !== "bank_feed",
  );
  return notifyAssignees(cards, "task_overdue", today, now);
}

/** §9 due-soon-check: work due today or tomorrow (same per-day dedup). */
export async function dueSoonCheckJob(now: Date = new Date()): Promise<NotifyJobSummary> {
  const today = firmLocalToday(now);
  const todayStr = formatLocalDate(today);
  const tomorrowStr = formatLocalDate(addDays(today, 1));
  const queue = await getUnifiedQueue(0, today);
  const cards = [...queue.buckets.due_today, ...queue.buckets.upcoming].filter(
    (c) =>
      c.assigneeId != null &&
      c.kind !== "bank_feed" &&
      (c.dueDate === todayStr || c.dueDate === tomorrowStr),
  );
  return notifyAssignees(cards, "task_due_soon", today, now);
}

/**
 * §9 bank-feed-alerts: overdue feeds plus feeds due today/tomorrow to the
 * client's bookkeeper. Waiting and deferred feeds land in their own queue
 * buckets, so selecting only the date buckets skips them by construction.
 */
export async function bankFeedAlertsJob(now: Date = new Date()): Promise<NotifyJobSummary> {
  const today = firmLocalToday(now);
  const todayStr = formatLocalDate(today);
  const tomorrowStr = formatLocalDate(addDays(today, 1));
  const queue = await getUnifiedQueue(0, today);
  const overdue = queue.buckets.overdue.filter((c) => c.kind === "bank_feed");
  const soon = [...queue.buckets.due_today, ...queue.buckets.upcoming].filter(
    (c) => c.kind === "bank_feed" && (c.dueDate === todayStr || c.dueDate === tomorrowStr),
  );
  const overdueSummary = await notifyAssignees(overdue, "task_overdue", today, now);
  const soonSummary = await notifyAssignees(soon, "task_due_soon", today, now);
  return {
    today: formatLocalDate(today),
    candidates: overdueSummary.candidates + soonSummary.candidates,
    notificationsSent: overdueSummary.notificationsSent + soonSummary.notificationsSent,
    failures: [...overdueSummary.failures, ...soonSummary.failures],
  };
}

// ── statement-overdue (§9: daily after 7:30 AM local; admins; 24h dedup) ──

export interface StatementOverdueSummary {
  today: string;
  overdueAccounts: number;
  notificationsSent: number;
  failures: EntityFailure[];
}

export async function statementOverdueJob(
  now: Date = new Date(),
): Promise<StatementOverdueSummary> {
  const today = firmLocalToday(now);
  const queueRows = (await getStatementQueue(today)).filter((r) => r.status.isOverdue);
  const admins = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.role, ["admin", "owner"]), eq(users.isActive, true)));

  const summary: StatementOverdueSummary = {
    today: formatLocalDate(today),
    overdueAccounts: queueRows.length,
    notificationsSent: 0,
    failures: [],
  };
  for (const row of queueRows) {
    for (const admin of admins) {
      try {
        const written = await emitOncePer24Hours(
          {
            userId: admin.id,
            type: "statement_overdue",
            title: `Statement overdue: ${row.accountName}`,
            message: `${row.clientName} - earliest missing statement released ${row.status.earliestMissingDate ?? "unknown"}`,
            link: "/statements",
            entityType: "account",
            entityId: row.accountId,
          },
          now,
        );
        if (written) summary.notificationsSent += 1;
      } catch (err) {
        summary.failures.push({
          entityType: "account",
          entityId: row.accountId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  return summary;
}

// ── missing-info reminders (correspondence hub: daily after 7:45 AM local) ─

export interface MissingInfoReminderSummary {
  today: string;
  /** Clients found with at least one missing-onboarding reason. */
  candidates: number;
  remindersSent: number;
  /** Per-client skip reasons (nothing_missing, cadence, no_contact_email). */
  skipped: { clientId: number; reason: string }[];
  failures: EntityFailure[];
}

/**
 * Correspondence hub (walkthrough 02:28:57-02:34:03): clients with missing
 * required onboarding info - portal never activated past the grace period,
 * or accounts still lacking confirmed statement details - get the branded
 * reminder mail listing exactly what's open. Dedup is cadence-based: at most
 * one reminder per client per REMINDER_CADENCE_DAYS days, with the
 * correspondence row itself as the dedup record; every send is audit-logged
 * by the engine (correspondence_email_sent). Per-client try/catch isolation
 * follows the §9 rule.
 */
export async function missingInfoReminderJob(
  now: Date = new Date(),
): Promise<MissingInfoReminderSummary> {
  const today = firmLocalToday(now);
  const { plans, skipped } = await computeMissingInfoReminders(now);
  const summary: MissingInfoReminderSummary = {
    today: formatLocalDate(today),
    candidates: plans.length,
    remindersSent: 0,
    skipped,
    failures: [],
  };
  for (const plan of plans) {
    try {
      const row = await sendMissingInfoReminder(plan.clientId, plan.reasons, null, now);
      if (row) summary.remindersSent += 1;
      else summary.skipped.push({ clientId: plan.clientId, reason: "no_contact_email" });
    } catch (err) {
      // §9 - per-entity isolation: one bad client cannot abort the batch.
      summary.failures.push({
        entityType: "client",
        entityId: plan.clientId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return summary;
}

// ── w9 reminders (§18 + Phase 3C: weekly chase until the W-9 arrives) ─────

export interface W9ReminderSummary {
  today: string;
  /** Recipients past the weekly cadence with a usable email. */
  candidates: number;
  remindersSent: number;
  /** Per-recipient skip reasons (no_email). */
  skipped: { recipientId: number; reason: string }[];
  failures: EntityFailure[];
}

/**
 * Weekly W-9 chase (Phase 3C): recipients still pending_w9 a week after the
 * last request get the branded request again, until the W-9 lands. Cadence
 * dedup rides on w9_requested_at (a manual resend resets the weekly clock);
 * per-recipient try/catch isolation follows the §9 rule; every send is
 * audit-logged (w9_request_reminded) and recorded in correspondence.
 */
export async function w9ReminderJob(now: Date = new Date()): Promise<W9ReminderSummary> {
  const today = firmLocalToday(now);
  const { plans, skipped } = await computeW9ReminderPlans(now);
  const summary: W9ReminderSummary = {
    today: formatLocalDate(today),
    candidates: plans.length,
    remindersSent: 0,
    skipped,
    failures: [],
  };
  for (const plan of plans) {
    try {
      await sendW9Reminder(plan, now);
      summary.remindersSent += 1;
    } catch (err) {
      // §9 - per-entity isolation: one bad recipient cannot abort the batch.
      summary.failures.push({
        entityType: "w9_recipient",
        entityId: plan.recipientId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return summary;
}

// ── stale-cleanup (§9: every 5 minutes) ───────────────────────────────────
export async function staleCleanupJob(now: Date = new Date()): Promise<StaleCleanupResult> {
  const result = await runStaleCleanup(now);
  // §16 - idle/auto-clock-out warnings push IMMEDIATELY. runStaleCleanup
  // writes its auto_clock_out rows directly, so stamp their push here (the
  // rows are fresh by definition; delivery itself is push.ts's seam).
  await db
    .update(notifications)
    .set({ pushSentAt: now })
    .where(
      and(
        inArray(notifications.notificationType, [...IMMEDIATE_PUSH_TYPES]),
        isNull(notifications.pushSentAt),
      ),
    );
  return result;
}

// ── mention-sms (§9/§16: every 5 minutes) ─────────────────────────────────

export interface MentionEscalationSummary {
  candidates: number;
  smsSent: number;
  /** Per-user skip reasons, for the job log. */
  skipped: { notificationId: number; userId: number; reason: string }[];
  failures: EntityFailure[];
}

/**
 * §16 mention escalation: an unread mention older than 15 minutes gets an
 * SMS, subject to (a) one SMS per user per 15 minutes and (b) - unlike push
 * - a STRICT requirement that the user has approved working hours and is
 * currently inside them (§22 approval gates the escalation).
 *
 * SMS delivery is a seam: no Twilio dependency. The row's sms_sent_at is
 * stamped and the message is logged; the Twilio sender plugs in where
 * marked. Chat tables may be empty until the chat wave - this reads only
 * the notifications table, so it works regardless.
 */
export async function mentionEscalationJob(
  now: Date = new Date(),
): Promise<MentionEscalationSummary> {
  const ageCutoff = new Date(now.getTime() - MENTION_SMS_AGE_MS);
  const candidates = await db
    .select()
    .from(notifications)
    .where(
      and(
        inArray(notifications.notificationType, [...MENTION_TYPES]),
        eq(notifications.isRead, false),
        isNull(notifications.smsSentAt),
        lte(notifications.createdAt, ageCutoff),
      ),
    )
    .orderBy(notifications.createdAt, notifications.id);

  const summary: MentionEscalationSummary = {
    candidates: candidates.length,
    smsSent: 0,
    skipped: [],
    failures: [],
  };

  for (const row of candidates) {
    try {
      // §16 rate limit: at most one SMS per user per 15 minutes. Checked
      // inside the loop so a send earlier in THIS run also counts.
      const rateSince = new Date(now.getTime() - MENTION_SMS_RATE_LIMIT_MS);
      const [recentSms] = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.userId, row.userId), gte(notifications.smsSentAt, rateSince)))
        .limit(1);
      if (recentSms) {
        summary.skipped.push({ notificationId: row.id, userId: row.userId, reason: "rate_limited" });
        continue;
      }

      const schedule = await getApprovedWorkingHours(row.userId);
      if (schedule == null) {
        summary.skipped.push({
          notificationId: row.id,
          userId: row.userId,
          reason: "no_approved_working_hours",
        });
        continue;
      }
      if (!isInsideWorkingHours(schedule, now)) {
        summary.skipped.push({
          notificationId: row.id,
          userId: row.userId,
          reason: "outside_working_hours",
        });
        continue;
      }

      // ── SMS SEAM (§16): Twilio plugs in here. sms_sent_at is the durable
      // record; without a provider the message is logged, mirroring the
      // email module's nothing-configured behavior (§16 Email and SMS). ──
      console.log(`[sms] mention escalation to user ${row.userId}: ${row.title}`);
      await db
        .update(notifications)
        .set({ smsSentAt: now })
        .where(eq(notifications.id, row.id));
      summary.smsSent += 1;
    } catch (err) {
      summary.failures.push({
        entityType: "notification",
        entityId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return summary;
}

// ── not-clocked-in alert (F4: every 5 minutes, weekdays) ─────────────────

/** F4 grace: the alert window opens this many minutes after the scheduled start. */
export const NOT_CLOCKED_IN_GRACE_MINUTES = 30;

export interface NotClockedInSummary {
  today: string;
  /** false on weekends - the job is a no-op then (F4: weekdays). */
  weekday: boolean;
  checked: number;
  alerted: number;
  skipped: { userId: number; reason: string }[];
  failures: EntityFailure[];
}

/**
 * F4 (walkthrough 02:08:30): on a weekday, a bookkeeper with approved
 * working hours for today who is past their start + 30-minute grace with NO
 * open day session alerts their direct manager plus every active admin.
 *
 * Dedup: emitOncePerDay per (recipient, type, entity=the bookkeeper) - one
 * alert per absent bookkeeper per firm-local day per recipient, however
 * often the 5-minute loop fires. Deactivated staff are excluded at
 * selection. The alert window closes at the scheduled end of their day, so
 * a bookkeeper who worked and clocked OUT never triggers an evening false
 * positive.
 */
export async function notClockedInAlertJob(now: Date = new Date()): Promise<NotClockedInSummary> {
  const parts = firmLocalParts(now);
  const today = firmLocalToday(now);
  const summary: NotClockedInSummary = {
    today: formatLocalDate(today),
    weekday: parts.weekday >= 1 && parts.weekday <= 5,
    checked: 0,
    alerted: 0,
    skipped: [],
    failures: [],
  };
  if (!summary.weekday) return summary;

  const [bookkeepers, admins, openDays] = await Promise.all([
    db.select().from(users).where(and(eq(users.role, "bookkeeper"), eq(users.isActive, true))),
    db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.isActive, true))),
    db
      .select({ userId: workstationTimeEntries.userId })
      .from(workstationTimeEntries)
      .where(
        and(
          eq(workstationTimeEntries.activityType, "day"),
          isNull(workstationTimeEntries.endedAt),
        ),
      ),
  ]);
  const clockedIn = new Set(openDays.map((r) => r.userId));
  const minutesNow = parts.hour * 60 + parts.minute;

  for (const bookkeeper of bookkeepers) {
    summary.checked += 1;
    try {
      if (clockedIn.has(bookkeeper.id)) {
        summary.skipped.push({ userId: bookkeeper.id, reason: "clocked_in" });
        continue;
      }
      const schedule = await getApprovedWorkingHours(bookkeeper.id);
      if (schedule == null) {
        summary.skipped.push({ userId: bookkeeper.id, reason: "no_approved_working_hours" });
        continue;
      }
      const window = scheduleWindowForWeekday(schedule, parts.weekday);
      if (window == null) {
        summary.skipped.push({ userId: bookkeeper.id, reason: "not_scheduled_today" });
        continue;
      }
      if (minutesNow < window.startMinutes + NOT_CLOCKED_IN_GRACE_MINUTES) {
        summary.skipped.push({ userId: bookkeeper.id, reason: "within_grace" });
        continue;
      }
      if (minutesNow >= window.endMinutes) {
        summary.skipped.push({ userId: bookkeeper.id, reason: "outside_schedule" });
        continue;
      }

      const recipients = new Set<number>(admins.map((a) => a.id));
      if (bookkeeper.managerId != null) recipients.add(bookkeeper.managerId);
      const name = `${bookkeeper.firstName} ${bookkeeper.lastName}`.trim();
      const startH = String(Math.floor(window.startMinutes / 60)).padStart(2, "0");
      const startM = String(window.startMinutes % 60).padStart(2, "0");
      for (const recipientId of recipients) {
        const written = await emitOncePerDay(
          {
            userId: recipientId,
            type: "not_clocked_in",
            title: `${name} hasn't clocked in`,
            message: `Scheduled to start at ${startH}:${startM} (+${NOT_CLOCKED_IN_GRACE_MINUTES} min grace) - no day session is open.`,
            link: "/reports/hours",
            entityType: "user",
            entityId: bookkeeper.id,
          },
          now,
        );
        if (written) summary.alerted += 1;
      }
    } catch (err) {
      // §9 - per-entity isolation: one bad bookkeeper cannot abort the batch.
      summary.failures.push({
        entityType: "user",
        entityId: bookkeeper.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return summary;
}

// ── deferred-push (§9/§16: every 5 minutes, 18-hour lookback) ─────────────

export interface DeferredPushSummary {
  candidates: number;
  delivered: number;
  skippedUsers: { userId: number; reason: string }[];
  failures: EntityFailure[];
}

/**
 * §16 deferred push: rows left with push_sent_at null because the user was
 * off-hours are delivered when the user's workday starts. Selection is
 * unread, unsent, created within 18 hours - anything older has aged out and
 * is never delivered (§9).
 */
export async function deferredPushJob(now: Date = new Date()): Promise<DeferredPushSummary> {
  const windowStart = new Date(now.getTime() - DEFERRED_PUSH_LOOKBACK_MS);
  const rows = await db
    .select()
    .from(notifications)
    .where(
      and(
        isNull(notifications.pushSentAt),
        eq(notifications.isRead, false),
        gte(notifications.createdAt, windowStart),
      ),
    )
    .orderBy(notifications.createdAt, notifications.id);

  const summary: DeferredPushSummary = {
    candidates: rows.length,
    delivered: 0,
    skippedUsers: [],
    failures: [],
  };

  const hoursCache = new Map<number, Awaited<ReturnType<typeof getApprovedWorkingHours>>>();
  const deliverable = new Map<number, boolean>();
  for (const row of rows) {
    try {
      if (!deliverable.has(row.userId)) {
        if (!hoursCache.has(row.userId)) {
          hoursCache.set(row.userId, await getApprovedWorkingHours(row.userId));
        }
        const schedule = hoursCache.get(row.userId);
        // No approved hours on file means emitNotification would have pushed
        // immediately; a deferred row for such a user is delivered outright.
        const ok = schedule == null || isInsideWorkingHours(schedule, now);
        deliverable.set(row.userId, ok);
        if (!ok) {
          summary.skippedUsers.push({ userId: row.userId, reason: "outside_working_hours" });
        }
      }
      if (!deliverable.get(row.userId)) continue;

      await sendPushToUser(row.userId, {
        title: row.title,
        body: row.message,
        url: row.link,
      });
      await db
        .update(notifications)
        .set({ pushSentAt: now })
        .where(eq(notifications.id, row.id));
      summary.delivered += 1;
    } catch (err) {
      summary.failures.push({
        entityType: "notification",
        entityId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return summary;
}
