import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  chatChannels,
  chatMessages,
  clients,
  notifications,
  users,
  workstationTimeEntries,
} from "@/db/schema";
import {
  ChatError,
  addChannelMember,
  createClientPortalChannel,
  dmSlug,
  ensureGeneralChannel,
  getChannelMembers,
  getChannelMessages,
  getOrCreateDm,
  getPresence,
  getTotalUnreadCount,
  listChannels,
  listStaffForDm,
  markChannelRead,
  parseMentions,
  sendMessage,
} from "@/server/chat";
import { seedDatabase } from "@/server/seed";
import { getStorageDriver } from "@/server/storage";
import { UploadValidationError } from "@/server/uploads";

import { TEST_TODAY, dbReachable } from "./helpers";

const reachable = await dbReachable();

let docsRoot: string;

const userIdByEmail = async (email: string): Promise<number> => {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!row) throw new Error(`seeded user not found: ${email}`);
  return row.id;
};

const channelIdsToClean: number[] = [];
const timeEntryIdsToClean: number[] = [];

function trackChannel(id: number) {
  channelIdsToClean.push(id);
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("chat pure helpers", () => {
  it("dmSlug is deterministic and order-independent", () => {
    expect(dmSlug(7, 3)).toBe("dm:3:7");
    expect(dmSlug(3, 7)).toBe("dm:3:7");
  });

  it("parseMentions reads @(id) and @[id], deduped, in order", () => {
    expect(parseMentions("hey @(12) and @[34], again @(12)")).toEqual([12, 34]);
    expect(parseMentions("@() @x @(abc) @(0) plain text")).toEqual([]);
    expect(parseMentions("")).toEqual([]);
  });
});

describe.skipIf(!reachable)("chat engine (HANDOFF §16)", () => {
  let mara: number;
  let theo: number;
  let dana: number;
  let priya: number;
  let jorge: number;
  let sofia: number;
  let alison: number;
  let harborlineId: number;

  beforeAll(async () => {
    docsRoot = await mkdtemp(path.join(tmpdir(), "firmos-chat-test-"));
    process.env.FIRMOS_DOCS_ROOT = docsRoot;
    await seedDatabase(TEST_TODAY);
    mara = await userIdByEmail("mara@blueledgerbooks.com");
    theo = await userIdByEmail("theo@blueledgerbooks.com");
    dana = await userIdByEmail("dana@blueledgerbooks.com");
    priya = await userIdByEmail("priya@blueledgerbooks.com");
    jorge = await userIdByEmail("jorge@blueledgerbooks.com");
    sofia = await userIdByEmail("sofia@blueledgerbooks.com");
    alison = await userIdByEmail("alison@harborlinemarine.com");
    const [c] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.legalName, "Harborline Marine Supply"));
    harborlineId = c.id;
  });

  afterAll(async () => {
    await db.delete(notifications).where(eq(notifications.notificationType, "chat_mention"));
    if (channelIdsToClean.length > 0) {
      await db.delete(chatChannels).where(inArray(chatChannels.id, channelIdsToClean));
    }
    if (timeEntryIdsToClean.length > 0) {
      await db
        .delete(workstationTimeEntries)
        .where(inArray(workstationTimeEntries.id, timeEntryIdsToClean));
    }
    await rm(docsRoot, { recursive: true, force: true });
  });

  // ── General channel ──

  it("ensureGeneralChannel is idempotent and seats all active staff", async () => {
    const general = await ensureGeneralChannel(mara);
    trackChannel(general.id);
    expect(general.kind).toBe("general");
    expect(general.slug).toBe("general");

    const again = await ensureGeneralChannel(mara);
    expect(again.id).toBe(general.id);

    const members = await getChannelMembers(general.id, mara);
    const memberIds = members.map((m) => m.id).sort((a, b) => a - b);
    expect(memberIds).toEqual([mara, theo, dana, priya, jorge, sofia].sort((a, b) => a - b));
    // Portal roles never join staff chat.
    expect(memberIds).not.toContain(alison);
  });

  // ── DMs ──

  it("getOrCreateDm uses the deterministic slug and is idempotent both ways", async () => {
    const dm = await getOrCreateDm(mara, jorge);
    trackChannel(dm.id);
    expect(dm.kind).toBe("dm");
    expect(dm.slug).toBe(`dm:${Math.min(mara, jorge)}:${Math.max(mara, jorge)}`);

    const reverse = await getOrCreateDm(jorge, mara);
    expect(reverse.id).toBe(dm.id);

    const members = await getChannelMembers(dm.id, mara);
    expect(members.map((m) => m.id).sort((a, b) => a - b)).toEqual(
      [mara, jorge].sort((a, b) => a - b),
    );
  });

  it("rejects self-DMs and DMs with portal roles", async () => {
    await expect(getOrCreateDm(mara, mara)).rejects.toThrow(ChatError);
    await expect(getOrCreateDm(mara, alison)).rejects.toThrow(/staff/);
  });

  it("listStaffForDm returns active staff minus the viewer", async () => {
    const people = await listStaffForDm(mara);
    const ids = people.map((p) => p.id);
    expect(ids).not.toContain(mara);
    expect(ids).not.toContain(alison);
    expect(ids).toEqual(expect.arrayContaining([theo, dana, priya, jorge, sofia]));
  });

  // ── Membership enforcement ──

  it("non-members cannot read, page, or post into a channel", async () => {
    const dm = await getOrCreateDm(mara, dana);
    trackChannel(dm.id);
    await expect(getChannelMessages(dm.id, sofia)).rejects.toThrow(/not a member/);
    await expect(getChannelMembers(dm.id, sofia)).rejects.toThrow(/not a member/);
    await expect(sendMessage(dm.id, sofia, "intruder")).rejects.toThrow(/not a member/);
    await expect(markChannelRead(dm.id, sofia)).rejects.toThrow(/not a member/);
  });

  // ── Mentions + notifications ──

  it("mentions notify mentioned members only, at high priority, linked to the channel", async () => {
    const dm = await getOrCreateDm(mara, jorge);
    trackChannel(dm.id);
    const theoMention = await sendMessage(
      dm.id,
      mara,
      `@(${jorge}) can you check the Harborline feed? Looping in @(${theo}) too`,
    );
    expect(theoMention.notifiedUserIds).toEqual([jorge]);

    const jorgeNotifs = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, jorge), eq(notifications.notificationType, "chat_mention")));
    expect(jorgeNotifs).toHaveLength(1);
    expect(jorgeNotifs[0].priority).toBe("high");
    expect(jorgeNotifs[0].link).toBe(`/messages?channel=${dm.id}`);
    expect(jorgeNotifs[0].entityType).toBe("chat_message");
    expect(jorgeNotifs[0].entityId).toBe(theoMention.message.id);
    expect(jorgeNotifs[0].title).toContain("Mara Ellison");

    // Theo was mentioned but is not a member: no notification.
    const theoNotifs = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, theo), eq(notifications.notificationType, "chat_mention")));
    expect(theoNotifs).toHaveLength(0);
  });

  it("self-mentions never notify the author", async () => {
    const dm = await getOrCreateDm(mara, jorge);
    trackChannel(dm.id);
    const result = await sendMessage(dm.id, mara, `note to self @(${mara})`);
    expect(result.notifiedUserIds).toEqual([]);
  });

  // ── Unread counts + read cursor ──

  it("unread counts derive from the member read cursor and own messages do not count", async () => {
    const dm = await getOrCreateDm(priya, sofia);
    trackChannel(dm.id);
    const t0 = new Date();
    await sendMessage(dm.id, priya, "first", undefined, new Date(t0.getTime() + 1000));
    await sendMessage(dm.id, priya, "second", undefined, new Date(t0.getTime() + 2000));

    const sofiaChannels = await listChannels(sofia);
    const sofiaDm = sofiaChannels.find((c) => c.id === dm.id);
    expect(sofiaDm?.unreadCount).toBe(2);
    expect(await getTotalUnreadCount(sofia)).toBe(2);

    // The sender's own posts never inflate her unread count.
    const priyaChannels = await listChannels(priya);
    expect(priyaChannels.find((c) => c.id === dm.id)?.unreadCount).toBe(0);

    // Read cursor: marking read zeroes the count; a new message bumps it.
    await markChannelRead(dm.id, sofia, new Date(t0.getTime() + 3000));
    expect((await listChannels(sofia)).find((c) => c.id === dm.id)?.unreadCount).toBe(0);
    await sendMessage(dm.id, priya, "third", undefined, new Date(t0.getTime() + 4000));
    expect((await listChannels(sofia)).find((c) => c.id === dm.id)?.unreadCount).toBe(1);
  });

  it("listChannels pins general first and carries last-message previews", async () => {
    // Regression: the sort reads lastMessage.createdAt as a Date even though
    // the last-message query is raw SQL (which returns strings).
    const general = await ensureGeneralChannel(mara);
    trackChannel(general.id);
    const dm = await getOrCreateDm(mara, jorge);
    trackChannel(dm.id);
    const t0 = new Date();
    await sendMessage(general.id, dana, "kickoff at 9:30", undefined, new Date(t0.getTime() - 2000));
    await sendMessage(dm.id, jorge, "feed is fixed", undefined, t0);

    const channels = await listChannels(mara);
    expect(channels[0].kind).toBe("general");
    const dmSummary = channels.find((c) => c.id === dm.id);
    expect(dmSummary?.lastMessage?.preview).toBe("feed is fixed");
    expect(dmSummary?.lastMessage?.createdAt).toBeInstanceOf(Date);
  });

  // ── Paging ──

  it("getChannelMessages pages newest-last with before/after cursors", async () => {
    const dm = await getOrCreateDm(mara, sofia);
    trackChannel(dm.id);
    const t0 = new Date();
    const sent = [] as { message: { id: number } }[];
    for (let i = 1; i <= 3; i++) {
      sent.push(await sendMessage(dm.id, mara, `msg ${i}`, undefined, new Date(t0.getTime() + i * 1000)));
    }

    const firstPage = await getChannelMessages(dm.id, sofia, { limit: 2 });
    expect(firstPage.messages.map((m) => m.body)).toEqual(["msg 2", "msg 3"]);
    expect(firstPage.hasMore).toBe(true);

    const older = await getChannelMessages(dm.id, sofia, { before: firstPage.messages[0].id });
    expect(older.messages.map((m) => m.body)).toEqual(["msg 1"]);
    expect(older.hasMore).toBe(false);

    const fresh = await getChannelMessages(dm.id, sofia, { after: sent[0].message.id });
    expect(fresh.messages.map((m) => m.body)).toEqual(["msg 2", "msg 3"]);
  });

  // ── Attachments ──

  it("stores a validated attachment under chat_attachments/{channel_id}/", async () => {
    const dm = await getOrCreateDm(mara, jorge);
    trackChannel(dm.id);
    const { message } = await sendMessage(dm.id, mara, "receipt attached", {
      fileName: "receipt.png",
      mimeType: "image/png",
      bytes: PNG_BYTES,
    });
    expect(message.hasAttachment).toBe(true);
    expect(message.attachmentName).toBe("receipt.png");

    const [row] = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.id, message.id));
    expect(row.attachmentPath).toMatch(new RegExp(`^chat_attachments/${dm.id}/`));

    const driver = await getStorageDriver();
    const bytes = await driver.get(row.attachmentPath!);
    expect(Buffer.from(bytes).equals(Buffer.from(PNG_BYTES))).toBe(true);
  });

  it("rejects invalid and oversized attachments through the §13 layers", async () => {
    const dm = await getOrCreateDm(mara, jorge);
    trackChannel(dm.id);
    await expect(
      sendMessage(dm.id, mara, "nope", {
        fileName: "payload.exe",
        mimeType: "application/x-msdownload",
        bytes: new Uint8Array([0x4d, 0x5a, 1, 2]),
      }),
    ).rejects.toThrow(UploadValidationError);
    await expect(
      sendMessage(dm.id, mara, "too big", {
        fileName: "big.zip",
        mimeType: "application/zip",
        bytes: new Uint8Array(50 * 1024 * 1024 + 1),
      }),
    ).rejects.toThrow(UploadValidationError);
  });

  // ── Client portal channels ──

  it("createClientPortalChannel is idempotent and seats portal user + bookkeeper + manager + owners", async () => {
    const channel = await createClientPortalChannel(harborlineId);
    trackChannel(channel.id);
    expect(channel.kind).toBe("client_portal");
    expect(channel.clientId).toBe(harborlineId);

    const again = await createClientPortalChannel(harborlineId);
    expect(again.id).toBe(channel.id);

    const members = await getChannelMembers(channel.id, mara);
    const ids = members.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining([alison, jorge, dana, mara]));
    // Admin and the unassigned manager/bookkeeper are not seated.
    expect(ids).not.toContain(theo);
    expect(ids).not.toContain(priya);
    expect(ids).not.toContain(sofia);
  });

  it("portal chat is text-only: attachments are refused", async () => {
    const channel = await createClientPortalChannel(harborlineId);
    trackChannel(channel.id);
    await expect(
      sendMessage(channel.id, mara, "file", {
        fileName: "receipt.png",
        mimeType: "image/png",
        bytes: PNG_BYTES,
      }),
    ).rejects.toThrow(/text-only/);
    // Text still flows.
    const { message } = await sendMessage(channel.id, mara, "Welcome aboard, Alison!");
    expect(message.body).toBe("Welcome aboard, Alison!");
  });

  it("staff cannot add members to client_portal or dm channels; general accepts adds", async () => {
    const portalChannel = await createClientPortalChannel(harborlineId);
    trackChannel(portalChannel.id);
    await expect(addChannelMember(portalChannel.id, theo)).rejects.toThrow(/provisioned/);

    const dm = await getOrCreateDm(mara, jorge);
    trackChannel(dm.id);
    await expect(addChannelMember(dm.id, theo)).rejects.toThrow(/fixed/);

    // General channels do accept explicit adds (a reactivated member case).
    const general = await ensureGeneralChannel(mara);
    trackChannel(general.id);
    await addChannelMember(general.id, jorge); // already a member: no-op, no throw
    const members = await getChannelMembers(general.id, mara);
    expect(members.filter((m) => m.id === jorge)).toHaveLength(1);
  });

  // ── Presence ──

  it("presence derives from open day sessions only", async () => {
    const before = await getPresence();
    expect(before.map((p) => p.userId)).not.toContain(sofia);

    const [open] = await db
      .insert(workstationTimeEntries)
      .values({ userId: sofia, activityType: "day", startedAt: new Date() })
      .returning();
    timeEntryIdsToClean.push(open.id);

    const during = await getPresence();
    expect(during.map((p) => p.userId)).toContain(sofia);

    await db
      .update(workstationTimeEntries)
      .set({ endedAt: new Date() })
      .where(eq(workstationTimeEntries.id, open.id));
    const after = await getPresence();
    expect(after.map((p) => p.userId)).not.toContain(sofia);
  });
});
