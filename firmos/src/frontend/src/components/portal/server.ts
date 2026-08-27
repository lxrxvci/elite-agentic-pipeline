import { cache } from 'react'
import { notFound, redirect } from 'next/navigation'

import { getSessionUser, type SessionUser } from '@/server/auth/guards'
import {
  PortalAccessDeniedError,
  PortalClientSelectionRequired,
  PortalDisabledError,
  getPortalContext,
  requirePortalClient,
  requirePortalEnabled,
  type PortalClientAccess,
  type PortalContext,
} from '@/server/portal'

/**
 * Portal page resolution (HANDOFF §12). One helper, called by the (portal)
 * layout and re-called (cached per request) by every page:
 *
 *  - kill switch: a disabled portal 404s, indistinguishable from one never
 *    built;
 *  - unauthenticated visitors redirect to /portal/login;
 *  - staff roles 404 (population isolation, §30 conv. 10);
 *  - client role resolves the acting client from the portal_client_id
 *    cookie: no cookie -> 'choose', stale/foreign -> 'stale' (re-select);
 *  - CPAs never use the cookie; their client id comes from the URL and is
 *    validated by the engine on every call.
 */

export type ActingSelection = 'ok' | 'choose' | 'stale'

export interface PortalPageState {
  user: SessionUser
  ctx: PortalContext
  /** The validated acting client (client role only, selection === 'ok'). */
  access: PortalClientAccess | null
  selection: ActingSelection
}

export const getPortalPageState = cache(async (): Promise<PortalPageState> => {
  try {
    await requirePortalEnabled()
  } catch (error) {
    if (error instanceof PortalDisabledError) notFound()
    throw error
  }

  const user = await getSessionUser()
  if (!user) redirect('/portal/login')
  if (user.normalizedRole !== 'client' && user.normalizedRole !== 'cpa') notFound()

  const ctx = await getPortalContext(user)

  let access: PortalClientAccess | null = null
  let selection: ActingSelection = 'ok'
  if (user.normalizedRole === 'client') {
    try {
      access = await requirePortalClient(user)
      selection = 'ok'
    } catch (error) {
      if (error instanceof PortalClientSelectionRequired) {
        selection = 'choose'
      } else if (error instanceof PortalAccessDeniedError) {
        selection = 'stale'
      } else {
        throw error
      }
    }
  }

  return { user, ctx, access, selection }
})

/**
 * Client-role page gate: CPAs 404 on client-scoped pages, and a client
 * without a valid acting selection renders nothing (the layout shows the
 * choose-your-business screen instead of children).
 */
export async function requireClientRolePage(): Promise<{
  state: PortalPageState
  access: PortalClientAccess | null
}> {
  const state = await getPortalPageState()
  if (state.user.normalizedRole !== 'client') notFound()
  return { state, access: state.selection === 'ok' ? state.access : null }
}

/** CPA-role page gate: client-role users 404 on the CPA surface. */
export async function requireCpaRolePage(): Promise<PortalPageState> {
  const state = await getPortalPageState()
  if (state.user.normalizedRole !== 'cpa') notFound()
  return state
}
