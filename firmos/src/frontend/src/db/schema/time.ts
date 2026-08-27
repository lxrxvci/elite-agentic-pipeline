import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { approvalRequestStatusEnum, workActivityTypeEnum, workingHoursStatusEnum } from "./enums";
import { createdAt, updatedAt } from "./shared";
import { clients } from "./clients";
import { users } from "./users";

/**
 * Time tracking (HANDOFF §7 - 3 models; §6.6, §17).
 *
 * Three independent timers overlap by design (day clock-in, activity timer,
 * per-task timer - the last lives on tasks + task_time_entries). Reports
 * and payroll compute a wall-clock UNION of intervals; summing them
 * triple-counts (§6.6).
 */

/**
 * §6.6/§17 - workstation sessions. activity_type='day' is the umbrella
 * session (one at a time, enforced by the partial unique index below);
 * other activity types are per-work-area timers where starting one
 * auto-closes the previous non-day entry.
 */
export const workstationTimeEntries = pgTable(
  "workstation_time_entries",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    activityType: workActivityTypeEnum("activity_type").notNull(),
    // Optional work context for the hours-clocked breakdown (§21).
    clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
    durationMinutes: integer("duration_minutes"),
    // Heartbeat target; the stale-cleanup job closes sessions idle beyond
    // the user's idle_timeout_minutes (§17).
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true, mode: "date" }),
    // True when closed by the idle/max-session stale-cleanup job.
    autoClosed: boolean("auto_closed").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    // One open day session per user (§6.6 "The umbrella session. One at a time.").
    uniqueIndex("workstation_time_entries_open_day_unique")
      .on(t.userId)
      .where(sql`${t.activityType} = 'day' and ${t.endedAt} is null`),
    index("workstation_time_entries_user_started_idx").on(t.userId, t.startedAt),
  ],
);

/**
 * §17 - a user cannot edit their own recorded time; they submit corrected
 * times and an admin/owner approves (applying the times and recalculating
 * the duration) or rejects.
 */
export const workstationTimeEditRequests = pgTable(
  "workstation_time_edit_requests",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    timeEntryId: integer("time_entry_id")
      .notNull()
      .references(() => workstationTimeEntries.id, { onDelete: "cascade" }),
    requestedStartedAt: timestamp("requested_started_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    requestedEndedAt: timestamp("requested_ended_at", { withTimezone: true, mode: "date" }),
    reason: text("reason"),
    status: approvalRequestStatusEnum("status").notNull().default("pending"),
    reviewedById: integer("reviewed_by_id").references((): AnyPgColumn => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [index("workstation_time_edit_requests_status_idx").on(t.status)],
);

/**
 * §16 - JSON weekly schedule through draft → pending → approved/rejected.
 * Staff submit; owners and admins approve. Gates deferred push delivery and
 * mention SMS escalation.
 */
export const userWorkingHours = pgTable(
  "user_working_hours",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** e.g. { mon: [{ start: "09:00", end: "17:00" }], … } in firm-local time. */
    schedule: jsonb("schedule").notNull(),
    status: workingHoursStatusEnum("status").notNull().default("draft"),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "date" }),
    reviewedById: integer("reviewed_by_id").references((): AnyPgColumn => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("user_working_hours_user_status_idx").on(t.userId, t.status)],
);
