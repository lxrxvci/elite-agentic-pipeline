'use server'

import { AuthError, requirePortalUser } from '@/server/auth/guards'
import {
  ChatError,
  createClientPortalChannel,
  getChannelMessages,
  markChannelRead,
  sendMessage,
  type ChannelMessagesPage,
  type ChatMessageView,
} from '@/server/chat'
import {
  assertPortalCapability,
  PortalError,
  requirePortalClient,
  type PortalClientAccess,
} from '@/server/portal'
import type { SessionUser } from '@/server/auth/guards'

/**
 * Portal chat server actions (HANDOFF §12/§16). The channel is resolved
 * ENTIRELY server-side from the acting-client cookie: no channel id or
 * client id ever arrives from the wire, so there is no IDOR surface. Every
 * action re-runs the full chain:
 *
 *   requirePortalUser (staff rejected, §30 conv. 10)
 *   -> client role only (the CPA surface has no chat)
 *   -> requirePortalClient (acting-client membership, §12)
 *   -> assertPortalCapability(can_message) (§29 - enforced by construction)
 *   -> createClientPortalChannel (idempotent provisioning)
 *
 * Portal chat is text-only: these actions accept no attachment parameter at
 * all, and the engine independently refuses attachments on client_portal
 * channels.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string }

function failure(error: unknown): { ok: false; status: number; error: string } {
  if (error instanceof PortalError || error instanceof ChatError) {
    return { ok: false, status: error.status, error: error.message }
  }
  if (error instanceof AuthError) {
    return { ok: false, status: error.status, error: 'You do not have permission to do that.' }
  }
  return { ok: false, status: 500, error: 'Something went wrong - try again.' }
}

interface PortalChatChannel {
  user: SessionUser
  access: PortalClientAccess
  channelId: number
}

async function requirePortalChatChannel(): Promise<PortalChatChannel> {
  const user = await requirePortalUser()
  if (user.normalizedRole !== 'client') {
    throw new PortalError(403, 'The CPA surface does not include chat')
  }
  const access = await requirePortalClient(user)
  assertPortalCapability(access, 'can_message')
  const channel = await createClientPortalChannel(access.clientId)
  return { user, access, channelId: channel.id }
}

/** Paged thread history for the acting client's channel. */
export async function portalChatMessagesAction(opts: {
  before?: number
  after?: number
  limit?: number
}): Promise<ActionResult<ChannelMessagesPage>> {
  try {
    const { user, channelId } = await requirePortalChatChannel()
    return { ok: true, data: await getChannelMessages(channelId, user.id, opts) }
  } catch (error) {
    return failure(error)
  }
}

/** Post a text-only message to the acting client's channel. */
export async function portalChatSendAction(
  body: string,
): Promise<ActionResult<{ message: ChatMessageView }>> {
  try {
    const { user, channelId } = await requirePortalChatChannel()
    const result = await sendMessage(channelId, user.id, typeof body === 'string' ? body : '')
    return { ok: true, data: { message: result.message } }
  } catch (error) {
    return failure(error)
  }
}

/** Advance the caller's read cursor for the acting client's channel. */
export async function portalChatReadAction(): Promise<ActionResult<{ read: true }>> {
  try {
    const { user, channelId } = await requirePortalChatChannel()
    await markChannelRead(channelId, user.id)
    return { ok: true, data: { read: true } }
  } catch (error) {
    return failure(error)
  }
}
