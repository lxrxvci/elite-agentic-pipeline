import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { chatChannelKindEnum, notificationPriorityEnum } from "./enums";
import { createdAt } from "./shared";
import { clients, contacts } from "./clients";
import { tasks } from "./tasks";
import { users } from "./users";

/**
 * Communication and notifications (HANDOFF §7 - 5 models; §16).
 */

/**
 * §16 - notification rows. notification_type is one of the 35 emitted types
 * (auto_clock_out, chat_mention, task_overdue, statement_overdue, …) plus a
 * system default; kept as text because the set is extended by app code.
 * Working-hours-aware delivery: push is immediate inside approved hours (or
 * for idle/auto-clock-out warnings), otherwise deferred with push_sent_at
 * null until the deferred-push job delivers it (18-hour lookback).
 */
export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    notificationType: text("notification_type").notNull(),
    title: text("title").notNull(),
    message: text("message"),
    link: text("link"),
    entityType: text("entity_type"),
    entityId: integer("entity_id"),
    priority: notificationPriorityEnum("priority").notNull().default("normal"),
    isRead: boolean("is_read").notNull().default(false),
    readAt: timestamp("read_at", { withTimezone: true, mode: "date" }),
    isResolved: boolean("is_resolved").notNull().default(false),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
    smsSentAt: timestamp("sms_sent_at", { withTimezone: true, mode: "date" }),
    pushSentAt: timestamp("push_sent_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [
    // §29 hot path: notification dedup filters (one per user/entity/local
    // calendar day for the 7 AM jobs; 24-hour rule for statement_overdue).
    // Plain created_at btree - a date(created_at) expression index would be
    // non-immutable on timestamptz; jobs filter created_at >= local midnight.
    index("notifications_dedup_idx").on(
      t.userId,
      t.notificationType,
      t.entityType,
      t.entityId,
      t.createdAt,
    ),
    // Bell summary / unread counts.
    index("notifications_user_unread_idx").on(t.userId, t.isRead),
    // §9 deferred-push job: unread, unsent, created within 18 hours.
    index("notifications_deferred_push_idx")
      .on(t.userId, t.createdAt)
      .where(sql`${t.pushSentAt} is null and ${t.isRead} = false`),
  ],
);

/** §16 - Web Push (VAPID) subscriptions. */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("push_subscriptions_endpoint_unique").on(t.endpoint),
    index("push_subscriptions_user_idx").on(t.userId),
  ],
);

/**
 * §16 - three channel kinds: general, dm (two members, deterministic slug),
 * and client_portal (provisioned by the portal; staff cannot add members
 * manually). Presence is derived from open day sessions, not stored here.
 */
export const chatChannels = pgTable(
  "chat_channels",
  {
    id: serial("id").primaryKey(),
    kind: chatChannelKindEnum("kind").notNull(),
    // Deterministic slug for dm channels; unique per client for client_portal.
    slug: text("slug"),
    clientId: integer("client_id").references(() => clients.id, { onDelete: "cascade" }),
    name: text("name"),
    createdById: integer("created_by_id").references((): AnyPgColumn => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("chat_channels_slug_unique").on(t.slug),
    uniqueIndex("chat_channels_client_portal_unique")
      .on(t.clientId)
      .where(sql`${t.kind} = 'client_portal'`),
  ],
);

export const chatChannelMembers = pgTable(
  "chat_channel_members",
  {
    id: serial("id").primaryKey(),
    channelId: integer("channel_id")
      .notNull()
      .references(() => chatChannels.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true, mode: "date" }),
    joinedAt: timestamp("joined_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("chat_channel_members_unique").on(t.channelId, t.userId)],
);

/**
 * §16 - mentions use the @(123) / @[123] id form and generate high-priority
 * notifications; unread mentions older than 15 minutes escalate to SMS.
 * Staff chat supports attachments (≤50 MB under the docs root); portal chat
 * is deliberately text-only.
 */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: serial("id").primaryKey(),
    channelId: integer("channel_id")
      .notNull()
      .references(() => chatChannels.id, { onDelete: "cascade" }),
    authorId: integer("author_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    attachmentPath: text("attachment_path"), // chat_attachments/{channel_id}/…
    attachmentName: text("attachment_name"),
    editedAt: timestamp("edited_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [index("chat_messages_channel_idx").on(t.channelId, t.createdAt)],
);

/**
 * Client correspondence (walkthrough 02:28:57-02:34:03): one row per email
 * or portal message, both directions. The staff client record and the portal
 * home read the same history; portal rows are limited to portal_visible.
 *
 * direction/channel/status/template stay TEXT (notifications precedent - the
 * sets are extended by app code): direction outbound|inbound, channel
 * email|portal, status queued|sent|failed|received, template names the
 * branded mail that produced the row (welcome, missing_info_reminder,
 * quote_ready, waiting_on_client, staff_composer) or "inbound".
 *
 * Thread matching for inbound replies: the subject token [firmOS #t-<id>]
 * (task-linked outbound mail) and resend_message_id (In-Reply-To/References).
 *
 * Read markers are per side: outbound rows carry portal_read_at (the client
 * read it), inbound rows carry staff_read_at (staff read it); the writer's
 * own side is stamped at write time. Badge counts derive from these.
 *
 * client_id is nullable for intake-stage mail (the quote email goes out
 * before conversion); intake_id links it, and conversion backfills client_id
 * so the client's history is continuous.
 */
export const correspondence = pgTable(
  "correspondence",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id").references(() => clients.id, { onDelete: "cascade" }),
    contactId: integer("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    direction: text("direction").notNull(), // outbound | inbound
    channel: text("channel").notNull(), // email | portal
    subject: text("subject"),
    bodyText: text("body_text").notNull(),
    fromEmail: text("from_email"),
    toEmail: text("to_email"),
    /** Optional thread link to the work item the mail is about. */
    taskId: integer("task_id").references(() => tasks.id, { onDelete: "set null" }),
    /** Internal context: what this mail was about (never portal-rendered). */
    note: text("note"),
    /** Which branded template produced it (outbound), or "inbound". */
    template: text("template").notNull().default("staff_composer"),
    status: text("status").notNull().default("queued"), // queued | sent | failed | received
    resendMessageId: text("resend_message_id"),
    /** Portal renders only portal_visible rows (§12 surface isolation). */
    portalVisible: boolean("portal_visible").notNull().default(true),
    /** The staff user who sent it; null for job/inbound mail. */
    sentById: integer("sent_by_id").references((): AnyPgColumn => users.id),
    /** Intake-stage mail link; conversion backfills client_id from it. */
    intakeId: integer("intake_id"),
    portalReadAt: timestamp("portal_read_at", { withTimezone: true, mode: "date" }),
    staffReadAt: timestamp("staff_read_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [
    // Per-client history (staff tab + portal home).
    index("correspondence_client_idx").on(t.clientId, t.createdAt),
    index("correspondence_contact_idx").on(t.contactId),
    index("correspondence_task_idx").on(t.taskId),
    // Staff badge: unread inbound replies per client.
    index("correspondence_staff_unread_idx")
      .on(t.clientId)
      .where(sql`${t.direction} = 'inbound' and ${t.staffReadAt} is null`),
    // Portal badge: unread firm mail per client.
    index("correspondence_portal_unread_idx")
      .on(t.clientId)
      .where(
        sql`${t.direction} = 'outbound' and ${t.portalVisible} = true and ${t.portalReadAt} is null`,
      ),
    // Inbound thread matching on In-Reply-To/References.
    index("correspondence_resend_message_idx").on(t.resendMessageId),
  ],
);
