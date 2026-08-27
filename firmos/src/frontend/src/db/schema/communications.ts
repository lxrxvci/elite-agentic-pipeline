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
import { clients } from "./clients";
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
