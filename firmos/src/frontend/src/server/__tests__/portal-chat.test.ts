import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { chatChannels, clients, clientUserAccess, users } from "@/db/schema";
import { toSessionUser } from "@/server/auth/guards";
import {
  ChatError,
  createClientPortalChannel,
  getChannelMembers,
  getChannelMessages,
  listChannels,
  markChannelRead,
  sendMessage,
} from "@/server/chat";
import {
  assertPortalCapabilityFor,
  PortalAccessDeniedError,
  PortalCapabilityError,
  requirePortalClientAccess,
} from "@/server/portal";
import { seedDatabase } from "@/server/seed";

import { TEST_TODAY, dbReachable } from "./helpers";

const reachable = await dbReachable();

/**
 * Portal chat rules (HANDOFF §12/§16, §29). The portal actions layer only
 * composes these engine guarantees, so they are tested here at the engine
 * boundary: capability enforcement, CPA exclusion, text-only channels, and
 * cross-client IDOR.
 */
describe.skipIf(!reachable)("portal chat (HANDOFF §16)", () => {
  let mara: number;
  let dana: number;
  let priya: number;
  let jorge: number;
  let sofia: number;
  let alison: number;
  let carlos: number;
  let harborlineId: number;
  let blueSpruceId: number;
  let copperlineId: number;

  const channelIdsToClean: number[] = [];

  const userRowByEmail = async (email: string) => {
    const [row] = await db.select().from(users).where(eq(users.email, email));
    if (!row) throw new Error(`seeded user not found: ${email}`);
    return row;
  };

  const clientIdByName = async (name: string): Promise<number> => {
    const [row] = await db.select({ id: clients.id }).from(clients).where(eq(clients.legalName, name));
    if (!row) throw new Error(`seeded client not found: ${name}`);
    return row.id;
  };

  beforeAll(async () => {
    process.env.FIRMOS_PORTAL_ENABLED = "1";
    await seedDatabase(TEST_TODAY);
    mara = (await userRowByEmail("mara@blueledgerbooks.com")).id;
    dana = (await userRowByEmail("dana@blueledgerbooks.com")).id;
    priya = (await userRowByEmail("priya@blueledgerbooks.com")).id;
    jorge = (await userRowByEmail("jorge@blueledgerbooks.com")).id;
    sofia = (await userRowByEmail("sofia@blueledgerbooks.com")).id;
    alison = (await userRowByEmail("alison@harborlinemarine.com")).id;
    carlos = (await userRowByEmail("carlos@riverstonetax.com")).id;
    harborlineId = await clientIdByName("Harborline Marine Supply");
    blueSpruceId = await clientIdByName("Blue Spruce Landscaping");
    copperlineId = await clientIdByName("Copperline Coffee Roasters");
  });

  afterAll(async () => {
    // Restore any capability/assignment flags the tests flipped.
    await db
      .update(clientUserAccess)
      .set({ canMessage: true })
      .where(and(eq(clientUserAccess.userId, alison), eq(clientUserAccess.clientId, blueSpruceId)));
    await db
      .update(clients)
      .set({ bookkeeperId: jorge })
      .where(eq(clients.id, harborlineId));
    if (channelIdsToClean.length > 0) {
      await db.delete(chatChannels).where(inArray(chatChannels.id, channelIdsToClean));
    }
  });

  it("provisions the client channel idempotently with the fixed membership", async () => {
    const channel = await createClientPortalChannel(harborlineId);
    channelIdsToClean.push(channel.id);
    expect(channel.kind).toBe("client_portal");

    const again = await createClientPortalChannel(harborlineId);
    expect(again.id).toBe(channel.id);

    const members = await getChannelMembers(channel.id, alison);
    const memberIds = members.map((m) => m.id);
    // §16 membership: portal user + bookkeeper + manager + owners.
    expect(memberIds).toContain(alison);
    expect(memberIds).toContain(jorge); // bookkeeper
    expect(memberIds).toContain(dana); // manager
    expect(memberIds).toContain(mara); // owner
    // Never: the CPA, the other bookkeeper, the other manager, admins.
    expect(memberIds).not.toContain(carlos);
    expect(memberIds).not.toContain(sofia);
    expect(memberIds).not.toContain(priya);
  });

  it("denies sending when can_message is off (§29 capability enforcement)", async () => {
    const alisonUser = toSessionUser(await userRowByEmail("alison@harborlinemarine.com"));

    // Seed grants can_message on both of alison's links; flip Blue Spruce off.
    await db
      .update(clientUserAccess)
      .set({ canMessage: false })
      .where(and(eq(clientUserAccess.userId, alison), eq(clientUserAccess.clientId, blueSpruceId)));

    await expect(
      assertPortalCapabilityFor(alisonUser, blueSpruceId, "can_message"),
    ).rejects.toThrow(PortalCapabilityError);

    // Harborline still has the capability.
    const access = await assertPortalCapabilityFor(alisonUser, harborlineId, "can_message");
    expect(access.clientId).toBe(harborlineId);
  });

  it("the CPA is never a channel member: reads and writes are refused", async () => {
    const channel = await createClientPortalChannel(harborlineId);
    if (!channelIdsToClean.includes(channel.id)) channelIdsToClean.push(channel.id);

    await expect(getChannelMessages(channel.id, carlos)).rejects.toThrow(ChatError);
    await expect(sendMessage(channel.id, carlos, "hello from the CPA")).rejects.toThrow(
      /not a member/i,
    );
  });

  it("client channels are text-only even with an attachment supplied", async () => {
    const channel = await createClientPortalChannel(harborlineId);
    if (!channelIdsToClean.includes(channel.id)) channelIdsToClean.push(channel.id);

    await expect(
      sendMessage(channel.id, alison, "see attached", {
        fileName: "statement.pdf",
        mimeType: "application/pdf",
        bytes: new Uint8Array([1, 2, 3]),
      }),
    ).rejects.toThrow(/text-only/i);
  });

  it("a client cannot read or post into another client's channel (IDOR)", async () => {
    const other = await createClientPortalChannel(copperlineId);
    channelIdsToClean.push(other.id);

    // Engine-level: alison holds no membership in Copperline's channel.
    await expect(getChannelMessages(other.id, alison)).rejects.toThrow(ChatError);
    await expect(sendMessage(other.id, alison, "intrusive")).rejects.toThrow(/not a member/i);

    // Portal-context level: Copperline is not in alison's linked set at all.
    const alisonUser = toSessionUser(await userRowByEmail("alison@harborlinemarine.com"));
    await expect(requirePortalClientAccess(alisonUser, copperlineId)).rejects.toThrow(
      PortalAccessDeniedError,
    );
  });

  it("portal users and staff share one thread with working read cursors", async () => {
    const channel = await createClientPortalChannel(harborlineId);
    if (!channelIdsToClean.includes(channel.id)) channelIdsToClean.push(channel.id);

    const sent = await sendMessage(channel.id, alison, "Where is my August statement?");
    const staffView = await getChannelMessages(channel.id, jorge);
    expect(staffView.messages.map((m) => m.id)).toContain(sent.message.id);

    const reply = await sendMessage(channel.id, jorge, "On its way - check Documents tomorrow.");
    await markChannelRead(channel.id, alison);
    const clientView = await getChannelMessages(channel.id, alison);
    expect(clientView.messages.map((m) => m.id)).toContain(reply.message.id);
  });

  it("staff assigned after provisioning auto-join and see the channel listed", async () => {
    const channel = await createClientPortalChannel(harborlineId);
    if (!channelIdsToClean.includes(channel.id)) channelIdsToClean.push(channel.id);
    expect(channel.clientId).toBe(harborlineId);

    // Reassign the bookkeeper AFTER provisioning: sofia holds no member row.
    await db.update(clients).set({ bookkeeperId: sofia }).where(eq(clients.id, harborlineId));

    const before = await listChannels(sofia);
    expect(before.map((c) => c.id)).toContain(channel.id);

    // First touch auto-joins: read works, and she is a member afterwards.
    const view = await getChannelMessages(channel.id, sofia);
    expect(view.messages).toBeDefined();
    const members = await getChannelMembers(channel.id, sofia);
    expect(members.map((m) => m.id)).toContain(sofia);
  });

  it("owners see every client channel in their list", async () => {
    const channel = await createClientPortalChannel(copperlineId);
    if (!channelIdsToClean.includes(channel.id)) channelIdsToClean.push(channel.id);

    const ownerList = await listChannels(mara);
    const copperEntry = ownerList.find((c) => c.id === channel.id);
    expect(copperEntry?.kind).toBe("client_portal");
    expect(copperEntry?.clientName).toBe("Copperline Coffee Roasters");
  });
});
