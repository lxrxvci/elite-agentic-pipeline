import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  chatChannelMembers,
  chatChannels,
  chatMessages,
  clients,
  users,
  workstationTimeEntries,
} from "@/db/schema";

import { emitNotification } from "./notifications";
import { getStorageDriver } from "./storage";
import { validateUpload } from "./uploads";

/**
 * Team chat engine (HANDOFF §16 - Chat).
 *
 * Three channel kinds:
 *  - general: one firm-wide room (slug "general"), members = all active
 *    staff; created lazily via ensureGeneralChannel.
 *  - dm: exactly two members, deterministic slug dm:{minId}:{maxId} so the
 *    pair maps to one channel regardless of who opens it first.
 *  - client_portal: provisioned by the portal flow
 *    (createClientPortalChannel), containing the client's portal users plus
 *    the bookkeeper, manager, and all active owners. Membership is fixed at
 *    provisioning - addChannelMember refuses these channels.
 *
 * Reads and writes are membership-gated BY CONSTRUCTION: every entry point
 * that touches a channel first proves the caller holds a member row, so no
 * caller can read or post into a channel they are not in.
 *
 * Mentions use the @(123) / @[123] id form (§16). Mentioned members get a
 * high-priority chat_mention notification linked at the channel; the §9
 * mention-escalation job reads those rows for SMS. Mentions of non-members
 * parse but never notify.
 *
 * Attachments (staff channels only; portal chat is text-only) go through the
 * §13 upload validation layers and the storage driver under
 * chat_attachments/{channel_id}/...
 *
 * Presence is NOT stored: it is derived from open day sessions in
 * workstation_time_entries (§16 "derived from who currently has an open day
 * session").
 */

// ── Errors ────────────────────────────────────────────────────────────────

export type ChatErrorStatus = 400 | 403 | 404;

export class ChatError extends Error {
  constructor(
    public readonly status: ChatErrorStatus,
    message: string,
  ) {
    super(message);
    this.name = "ChatError";
  }
}

// ── View models ───────────────────────────────────────────────────────────

export type ChatChannelKind = "general" | "dm" | "client_portal";

export interface ChatPerson {
  id: number;
  name: string;
  initials: string;
  role: string;
}

export interface ChatMessageView {
  id: number;
  channelId: number;
  authorId: number;
  authorName: string;
  authorInitials: string;
  body: string;
  attachmentName: string | null;
  /** Download goes through the API route; the storage path never leaves the server. */
  hasAttachment: boolean;
  createdAt: Date;
  editedAt: Date | null;
}

export interface ChannelMessagesPage {
  messages: ChatMessageView[];
  /** True when an older page exists beyond the `before` cursor. */
  hasMore: boolean;
}

export interface ChatChannelSummary {
  id: number;
  kind: ChatChannelKind;
  name: string | null;
  clientId: number | null;
  clientName: string | null;
  /** dm only: the member who is not the viewer. */
  otherMember: ChatPerson | null;
  memberCount: number;
  lastMessage: {
    id: number;
    authorName: string;
    preview: string;
    createdAt: Date;
  } | null;
  unreadCount: number;
  lastReadAt: Date | null;
}

export interface PresenceEntry {
  userId: number;
  name: string;
  initials: string;
}

// ── Pure helpers ──────────────────────────────────────────────────────────

/** §16 deterministic DM slug: the same pair resolves to one channel. */
export function dmSlug(a: number, b: number): string {
  return `dm:${Math.min(a, b)}:${Math.max(a, b)}`;
}

/** §16 mention id form: @(123) or @[123]. Unique ids, in order of appearance. */
export function parseMentions(body: string): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const match of body.matchAll(/@[([](\d+)[)\]]/g)) {
    const id = Number(match[1]);
    if (Number.isInteger(id) && id > 0 && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function initialsOf(firstName: string, lastName: string): string {
  return `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase();
}

function personOf(row: {
  id: number;
  firstName: string;
  lastName: string;
  role: string;
}): ChatPerson {
  return {
    id: row.id,
    name: `${row.firstName} ${row.lastName}`,
    initials: initialsOf(row.firstName, row.lastName),
    role: row.role,
  };
}

// ── Membership gate (by construction) ─────────────────────────────────────

/**
 * Membership provisioning for client_portal channels is point-in-time
 * (createClientPortalChannel seats the people assigned AT provisioning). A
 * bookkeeper/manager assigned to the client later - or an owner created
 * later - is still staff for that client, so first touch auto-joins them
 * here. This is provisioning, not the manual addChannelMember path, which
 * stays refused for client_portal channels.
 */
async function canAutoJoinClientChannel(
  channel: { kind: string; clientId: number | null },
  userId: number,
): Promise<boolean> {
  if (channel.kind !== "client_portal" || channel.clientId == null) return false;
  const [user] = await db
    .select({ role: users.role, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user || !user.isActive) return false;
  const role = user.role.toLowerCase();
  if (!(["owner", "manager", "bookkeeper"] as const).includes(role as "owner")) return false;
  if (role === "owner") return true;
  const [client] = await db
    .select({ bookkeeperId: clients.bookkeeperId, managerId: clients.managerId })
    .from(clients)
    .where(eq(clients.id, channel.clientId))
    .limit(1);
  return client != null && (client.bookkeeperId === userId || client.managerId === userId);
}

async function requireMembership(channelId: number, userId: number) {
  const [membership] = await db
    .select()
    .from(chatChannelMembers)
    .where(
      and(eq(chatChannelMembers.channelId, channelId), eq(chatChannelMembers.userId, userId)),
    )
    .limit(1);
  if (membership) return membership;

  const [channel] = await db
    .select()
    .from(chatChannels)
    .where(eq(chatChannels.id, channelId))
    .limit(1);
  if (channel && (await canAutoJoinClientChannel(channel, userId))) {
    await addMembers(channelId, [userId]);
    const [joined] = await db
      .select()
      .from(chatChannelMembers)
      .where(
        and(eq(chatChannelMembers.channelId, channelId), eq(chatChannelMembers.userId, userId)),
      )
      .limit(1);
    if (joined) return joined;
  }
  throw new ChatError(403, "You are not a member of this channel");
}

async function requireChannel(channelId: number) {
  const [channel] = await db
    .select()
    .from(chatChannels)
    .where(eq(chatChannels.id, channelId))
    .limit(1);
  if (!channel) throw new ChatError(404, "Channel not found");
  return channel;
}

// ── Channel list ──────────────────────────────────────────────────────────

const PREVIEW_LENGTH = 80;

/**
 * Every channel `userId` belongs to, with the last message and an unread
 * count derived from the member read cursor (last_read_at, falling back to
 * joined_at for members who have never opened the channel). The viewer's own
 * messages never count as unread.
 *
 * client_portal channels are ALSO listed for staff who manage the client
 * (bookkeeper/manager, or any owner) but hold no member row yet - channel
 * provisioning is point-in-time, so staff assigned after provisioning would
 * otherwise never see the channel. The cursor fallback for such rows is the
 * channel creation time; first touch auto-joins them (requireMembership).
 */
export async function listChannels(userId: number): Promise<ChatChannelSummary[]> {
  const memberships = await db
    .select({
      channel: chatChannels,
      membership: chatChannelMembers,
      clientName: clients.legalName,
    })
    .from(chatChannelMembers)
    .innerJoin(chatChannels, eq(chatChannels.id, chatChannelMembers.channelId))
    .leftJoin(clients, eq(clients.id, chatChannels.clientId))
    .where(eq(chatChannelMembers.userId, userId));

  interface ChannelEntry {
    channel: typeof chatChannels.$inferSelect;
    clientName: string | null;
    lastReadAt: Date | null;
    /** Cursor fallback when the viewer has never read the channel. */
    cursorFloor: Date;
  }

  const entries: ChannelEntry[] = memberships.map((m) => ({
    channel: m.channel,
    clientName: m.clientName,
    lastReadAt: m.membership.lastReadAt,
    cursorFloor: m.membership.lastReadAt ?? m.membership.joinedAt,
  }));

  // Managed-but-not-yet-member client channels (see the header comment).
  const [viewer] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (viewer) {
    const isOwner = viewer.role.toLowerCase() === "owner";
    const managed = await db
      .select({ channel: chatChannels, clientName: clients.legalName })
      .from(chatChannels)
      .innerJoin(clients, eq(clients.id, chatChannels.clientId))
      .where(
        and(
          eq(chatChannels.kind, "client_portal"),
          isOwner
            ? undefined
            : or(eq(clients.bookkeeperId, userId), eq(clients.managerId, userId)),
        ),
      );
    const known = new Set(entries.map((e) => e.channel.id));
    for (const row of managed) {
      if (known.has(row.channel.id)) continue;
      entries.push({
        channel: row.channel,
        clientName: row.clientName,
        lastReadAt: null,
        cursorFloor: row.channel.createdAt,
      });
    }
  }

  if (entries.length === 0) return [];

  const channelIds = entries.map((e) => e.channel.id);

  // Last message per channel: one query, distinct on channel, newest wins.
  const lastRows = (await db.execute(sql`
    select distinct on (m.channel_id)
      m.channel_id, m.id, m.body, m.created_at, u.first_name, u.last_name
    from chat_messages m
    join users u on u.id = m.author_id
    where m.channel_id in ${channelIds}
    order by m.channel_id, m.id desc
  `)) as unknown as {
    channel_id: number;
    id: number;
    body: string;
    created_at: Date;
    first_name: string;
    last_name: string;
  }[];
  const lastByChannel = new Map(lastRows.map((r) => [r.channel_id, r]));

  // Unread candidates: messages past the viewer's oldest cursor, not their
  // own. Counted per channel against that channel's cursor below.
  const cursors = entries.map((e) => e.cursorFloor);
  const minCursor = new Date(Math.min(...cursors.map((d) => d.getTime())));
  const unreadRows = await db
    .select({
      channelId: chatMessages.channelId,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(
      and(
        inArray(chatMessages.channelId, channelIds),
        gt(chatMessages.createdAt, minCursor),
        ne(chatMessages.authorId, userId),
      ),
    );

  // Member counts and (for dm) the other member.
  const memberRows = await db
    .select({
      channelId: chatChannelMembers.channelId,
      user: {
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
      },
    })
    .from(chatChannelMembers)
    .innerJoin(users, eq(users.id, chatChannelMembers.userId))
    .where(inArray(chatChannelMembers.channelId, channelIds));
  const membersByChannel = new Map<number, ChatPerson[]>();
  for (const row of memberRows) {
    const list = membersByChannel.get(row.channelId) ?? [];
    list.push(personOf(row.user));
    membersByChannel.set(row.channelId, list);
  }

  const summaries = entries.map((e) => {
    const unreadCount = unreadRows.filter(
      (r) => r.channelId === e.channel.id && r.createdAt > e.cursorFloor,
    ).length;
    const last = lastByChannel.get(e.channel.id);
    const members = membersByChannel.get(e.channel.id) ?? [];
    return {
      id: e.channel.id,
      kind: e.channel.kind,
      name: e.channel.name,
      clientId: e.channel.clientId,
      clientName: e.clientName,
      otherMember:
        e.channel.kind === "dm" ? (members.find((p) => p.id !== userId) ?? null) : null,
      memberCount: members.length,
      lastMessage: last
        ? {
            id: last.id,
            authorName: `${last.first_name} ${last.last_name}`,
            preview:
              last.body.length > PREVIEW_LENGTH
                ? `${last.body.slice(0, PREVIEW_LENGTH - 1)}…`
                : last.body,
            // db.execute returns timestamps as strings; coerce for the view model.
            createdAt: new Date(last.created_at),
          }
        : null,
      unreadCount,
      lastReadAt: e.lastReadAt,
    } satisfies ChatChannelSummary;
  });

  // general first, then most recent activity; quiet channels sink.
  summaries.sort((a, b) => {
    if (a.kind === "general") return -1;
    if (b.kind === "general") return 1;
    const aTime = a.lastMessage?.createdAt.getTime() ?? 0;
    const bTime = b.lastMessage?.createdAt.getTime() ?? 0;
    return bTime - aTime;
  });
  return summaries;
}

/** Total unread across every channel - feeds the sidebar badge. */
export async function getTotalUnreadCount(userId: number): Promise<number> {
  const summaries = await listChannels(userId);
  return summaries.reduce((n, c) => n + c.unreadCount, 0);
}

// ── Channel creation ──────────────────────────────────────────────────────

const STAFF_ROLES = ["owner", "admin", "manager", "bookkeeper"] as const;

async function addMembers(channelId: number, userIds: number[]): Promise<void> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  await db
    .insert(chatChannelMembers)
    .values(unique.map((userId) => ({ channelId, userId })))
    .onConflictDoNothing({ target: [chatChannelMembers.channelId, chatChannelMembers.userId] });
}

/**
 * The firm-wide general room (§16). Idempotent on the "general" slug;
 * membership is every active staff login (portal roles never join staff chat).
 */
export async function ensureGeneralChannel(createdById: number) {
  const [existing] = await db
    .select()
    .from(chatChannels)
    .where(eq(chatChannels.slug, "general"))
    .limit(1);
  if (existing) return existing;

  const staff = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isActive, true), inArray(users.role, [...STAFF_ROLES])));

  const [channel] = await db
    .insert(chatChannels)
    .values({ kind: "general", slug: "general", name: "General", createdById })
    .onConflictDoNothing({ target: chatChannels.slug })
    .returning();
  const resolved =
    channel ??
    (await db.select().from(chatChannels).where(eq(chatChannels.slug, "general")).limit(1))[0];
  await addMembers(
    resolved.id,
    staff.map((s) => s.id),
  );
  return resolved;
}

/**
 * §16 dm: two members, deterministic slug. Idempotent - the same pair always
 * resolves to the same channel. DMs are staff-only on this surface.
 */
export async function getOrCreateDm(userId: number, otherUserId: number) {
  if (userId === otherUserId) {
    throw new ChatError(400, "You cannot open a direct message with yourself");
  }
  const [other] = await db.select().from(users).where(eq(users.id, otherUserId)).limit(1);
  if (!other || !other.isActive) throw new ChatError(404, "That person was not found");
  if (!(STAFF_ROLES as readonly string[]).includes(other.role)) {
    throw new ChatError(400, "Direct messages are between staff members");
  }

  const slug = dmSlug(userId, otherUserId);
  const [existing] = await db
    .select()
    .from(chatChannels)
    .where(eq(chatChannels.slug, slug))
    .limit(1);
  if (existing) return existing;

  const [channel] = await db
    .insert(chatChannels)
    .values({ kind: "dm", slug, createdById: userId })
    .onConflictDoNothing({ target: chatChannels.slug })
    .returning();
  const resolved =
    channel ??
    (await db.select().from(chatChannels).where(eq(chatChannels.slug, slug)).limit(1))[0];
  await addMembers(resolved.id, [userId, otherUserId]);
  return resolved;
}

/**
 * §16 client_portal: provisioned for the portal, idempotent per client
 * (partial unique index on (client_id) where kind = 'client_portal').
 * Members: the client's portal users (client-role logins with a
 * ClientUserAccess row), the client's bookkeeper and manager, and every
 * active owner. Staff cannot add members manually - see addChannelMember.
 */
export async function createClientPortalChannel(clientId: number) {
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) throw new ChatError(404, "Client not found");

  const [existing] = await db
    .select()
    .from(chatChannels)
    .where(and(eq(chatChannels.clientId, clientId), eq(chatChannels.kind, "client_portal")))
    .limit(1);
  if (existing) return existing;

  const portalUsers = await db.execute(sql`
    select u.id from users u
    join client_user_access cua on cua.user_id = u.id
    where cua.client_id = ${clientId} and u.role = 'client' and u.is_active
  `) as unknown as { id: number }[];
  const owners = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "owner"), eq(users.isActive, true)));

  const memberIds = [
    ...portalUsers.map((p) => p.id),
    ...owners.map((o) => o.id),
    ...(client.bookkeeperId ? [client.bookkeeperId] : []),
    ...(client.managerId ? [client.managerId] : []),
  ];

  const [channel] = await db
    .insert(chatChannels)
    .values({
      kind: "client_portal",
      slug: `client:${clientId}`,
      clientId,
      name: client.legalName,
    })
    .onConflictDoNothing()
    .returning();
  const resolved =
    channel ??
    (
      await db
        .select()
        .from(chatChannels)
        .where(and(eq(chatChannels.clientId, clientId), eq(chatChannels.kind, "client_portal")))
        .limit(1)
    )[0];
  await addMembers(resolved.id, memberIds);
  return resolved;
}

/**
 * Manual membership changes are only possible on general channels. DM
 * membership is the fixed pair; client_portal membership is provisioned by
 * the portal flow (§16 "staff cannot add members to these manually").
 */
export async function addChannelMember(channelId: number, userId: number): Promise<void> {
  const channel = await requireChannel(channelId);
  if (channel.kind === "client_portal") {
    throw new ChatError(403, "Client channel membership is provisioned by the portal");
  }
  if (channel.kind === "dm") {
    throw new ChatError(403, "Direct message membership is fixed at two people");
  }
  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isActive, true)))
    .limit(1);
  if (!target) throw new ChatError(404, "That person was not found");
  await addMembers(channelId, [userId]);
}

// ── Messages ──────────────────────────────────────────────────────────────

export interface GetChannelMessagesOptions {
  /** Page cursor: messages older than this id (for "load earlier"). */
  before?: number;
  /** Polling cursor: messages newer than this id. */
  after?: number;
  limit?: number;
}

const DEFAULT_PAGE_SIZE = 50;

/**
 * Paged channel history, membership-gated. Default page is the newest
 * `limit` messages returned oldest-first; `before` pages backwards, `after`
 * pages forwards (10s polling).
 */
export async function getChannelMessages(
  channelId: number,
  viewerId: number,
  opts: GetChannelMessagesOptions = {},
): Promise<ChannelMessagesPage> {
  await requireMembership(channelId, viewerId);
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_PAGE_SIZE, 1), 200);

  const conditions = [eq(chatMessages.channelId, channelId)];
  if (opts.before != null) conditions.push(lt(chatMessages.id, opts.before));
  if (opts.after != null) conditions.push(gt(chatMessages.id, opts.after));

  const rows = await db
    .select({
      message: chatMessages,
      author: {
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
      },
    })
    .from(chatMessages)
    .innerJoin(users, eq(users.id, chatMessages.authorId))
    .where(and(...conditions))
    // Newest-first for the initial/before page so `limit` clips the OLD end;
    // ascending for the after-poll so it clips the new end.
    .orderBy(opts.after != null ? asc(chatMessages.id) : desc(chatMessages.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  if (opts.after == null) page.reverse();

  return {
    hasMore,
    messages: page.map((r) => ({
      id: r.message.id,
      channelId: r.message.channelId,
      authorId: r.author.id,
      authorName: `${r.author.firstName} ${r.author.lastName}`,
      authorInitials: initialsOf(r.author.firstName, r.author.lastName),
      body: r.message.body,
      attachmentName: r.message.attachmentName,
      hasAttachment: r.message.attachmentPath != null,
      createdAt: r.message.createdAt,
      editedAt: r.message.editedAt,
    })),
  };
}

/** Channel roster for the mention typeahead and mention-chip rendering. */
export async function getChannelMembers(
  channelId: number,
  viewerId: number,
): Promise<ChatPerson[]> {
  await requireMembership(channelId, viewerId);
  const rows = await db
    .select({ user: users })
    .from(chatChannelMembers)
    .innerJoin(users, eq(users.id, chatChannelMembers.userId))
    .where(eq(chatChannelMembers.channelId, channelId))
    .orderBy(asc(users.firstName), asc(users.lastName));
  return rows.map((r) => personOf(r.user));
}

/** People picker for the new-DM flow: active staff, excluding the viewer. */
export async function listStaffForDm(userId: number): Promise<ChatPerson[]> {
  const rows = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.isActive, true),
        inArray(users.role, [...STAFF_ROLES]),
        ne(users.id, userId),
      ),
    )
    .orderBy(asc(users.firstName), asc(users.lastName));
  return rows.map(personOf);
}

export interface ChatAttachmentInput {
  fileName: string;
  mimeType: string | null;
  bytes: Uint8Array;
}

function channelLabel(channel: typeof chatChannels.$inferSelect, clientName?: string | null) {
  if (channel.kind === "general") return "#general";
  if (channel.kind === "client_portal") return clientName ?? channel.name ?? "a client channel";
  return "a direct message";
}

/**
 * Post a message (§16). Membership-gated; the sender's read cursor advances
 * so their own post never shows as unread. Mentions in the @(123) / @[123]
 * form notify mentioned MEMBERS only (never the author), high priority,
 * linked at the channel - the §9 escalation job escalates unread ones to SMS.
 *
 * Attachments run the five §13 validation layers and land under
 * chat_attachments/{channel_id}/ through the storage driver. Portal channels
 * are text-only by spec: an attachment there is refused.
 */
export async function sendMessage(
  channelId: number,
  userId: number,
  body: string,
  attachment?: ChatAttachmentInput,
  now: Date = new Date(),
): Promise<{ message: ChatMessageView; notifiedUserIds: number[] }> {
  await requireMembership(channelId, userId);
  const channel = await requireChannel(channelId);

  const trimmed = body.trim();
  if (trimmed === "" && !attachment) {
    throw new ChatError(400, "Write a message or attach a file first");
  }
  if (attachment && channel.kind === "client_portal") {
    throw new ChatError(400, "Client channels are text-only - use the document request flow");
  }

  const [author] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!author) throw new ChatError(404, "Author not found");

  // §13: validate before anything touches storage or the database.
  let storedPath: string | null = null;
  let storedName: string | null = null;
  if (attachment) {
    const validated = validateUpload(attachment.fileName, attachment.mimeType, attachment.bytes);
    storedPath = `chat_attachments/${channelId}/${randomUUID()}-${validated.fileName}`;
    storedName = validated.fileName;
    const driver = await getStorageDriver();
    await driver.put(storedPath, validated.bytes);
  }

  let message: typeof chatMessages.$inferSelect;
  try {
    [message] = await db
      .insert(chatMessages)
      .values({
        channelId,
        authorId: userId,
        body: trimmed,
        attachmentPath: storedPath,
        attachmentName: storedName,
        createdAt: now,
      })
      .returning();
  } catch (err) {
    // Do not orphan the file when the row insert fails.
    if (storedPath) {
      const driver = await getStorageDriver();
      await driver.delete(storedPath).catch(() => undefined);
    }
    throw err;
  }

  // The sender has, by definition, read up to their own message.
  await db
    .update(chatChannelMembers)
    .set({ lastReadAt: now })
    .where(
      and(eq(chatChannelMembers.channelId, channelId), eq(chatChannelMembers.userId, userId)),
    );

  // §16 mentions: parse the id form, keep only mentioned MEMBERS, notify
  // each once at high priority with a link back to the channel.
  const mentionedIds = parseMentions(trimmed).filter((id) => id !== userId);
  const notifiedUserIds: number[] = [];
  if (mentionedIds.length > 0) {
    const memberRows = await db
      .select({ userId: chatChannelMembers.userId })
      .from(chatChannelMembers)
      .where(
        and(
          eq(chatChannelMembers.channelId, channelId),
          inArray(chatChannelMembers.userId, mentionedIds),
        ),
      );
    const memberIds = memberRows.map((r) => r.userId);
    const [clientRow] = channel.clientId
      ? await db
          .select({ legalName: clients.legalName })
          .from(clients)
          .where(eq(clients.id, channel.clientId))
          .limit(1)
      : [null];
    const authorName = `${author.firstName} ${author.lastName}`;
    const excerpt = trimmed.length > 140 ? `${trimmed.slice(0, 139)}…` : trimmed;
    for (const mentionedId of memberIds) {
      await emitNotification(
        {
          userId: mentionedId,
          type: "chat_mention",
          title: `${authorName} mentioned you in ${channelLabel(channel, clientRow?.legalName)}`,
          message: excerpt === "" ? null : excerpt,
          link: `/messages?channel=${channelId}`,
          entityType: "chat_message",
          entityId: message.id,
          priority: "high",
        },
        now,
      );
      notifiedUserIds.push(mentionedId);
    }
  }

  return {
    message: {
      id: message.id,
      channelId: message.channelId,
      authorId: userId,
      authorName: `${author.firstName} ${author.lastName}`,
      authorInitials: initialsOf(author.firstName, author.lastName),
      body: message.body,
      attachmentName: message.attachmentName,
      hasAttachment: message.attachmentPath != null,
      createdAt: message.createdAt,
      editedAt: message.editedAt,
    },
    notifiedUserIds,
  };
}

/**
 * Advance the member read cursor (§16 read receipts are per-channel, stored
 * on the member row's last_read_at - the column exists, no schema gap).
 */
export async function markChannelRead(
  channelId: number,
  userId: number,
  now: Date = new Date(),
): Promise<void> {
  // Auto-joins staff who manage the client (client_portal channels); throws
  // for non-members, same as before.
  await requireMembership(channelId, userId);
  await db
    .update(chatChannelMembers)
    .set({ lastReadAt: now })
    .where(
      and(eq(chatChannelMembers.channelId, channelId), eq(chatChannelMembers.userId, userId)),
    );
}

// ── Presence (§16: derived, never stored) ─────────────────────────────────

/**
 * Who is "present": staff with an OPEN day session (activity_type='day',
 * ended_at is null) in workstation_time_entries. The stale-cleanup job owns
 * closing abandoned sessions, so an open row means an active workday.
 */
export async function getPresence(): Promise<PresenceEntry[]> {
  const rows = await db
    .selectDistinct({ user: users })
    .from(workstationTimeEntries)
    .innerJoin(users, eq(users.id, workstationTimeEntries.userId))
    .where(
      and(
        eq(workstationTimeEntries.activityType, "day"),
        isNull(workstationTimeEntries.endedAt),
        eq(users.isActive, true),
      ),
    )
    .orderBy(asc(users.firstName), asc(users.lastName));
  return rows.map((r) => ({
    userId: r.user.id,
    name: `${r.user.firstName} ${r.user.lastName}`,
    initials: initialsOf(r.user.firstName, r.user.lastName),
  }));
}

// ── Attachment download seam (used by the API route) ─────────────────────

export interface ChatAttachmentDownload {
  path: string;
  fileName: string;
}

/**
 * Resolve a message's attachment for download, membership-gated. Returns
 * null when the message has no attachment. The storage path stays server
 * side; the route streams through the driver.
 */
export async function getAttachmentForDownload(
  messageId: number,
  userId: number,
): Promise<ChatAttachmentDownload | null> {
  const [message] = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.id, messageId))
    .limit(1);
  if (!message) throw new ChatError(404, "Message not found");
  await requireMembership(message.channelId, userId);
  if (!message.attachmentPath) return null;
  return { path: message.attachmentPath, fileName: message.attachmentName ?? "attachment" };
}
