'use server'

import { revalidatePath } from 'next/cache'

import { requireStaff } from '@/server/auth/guards'
import { BumperLaneLockedError } from '@/server/bumper-lanes'
import type { WorkCardKind } from '@/server/queue'
import type { RolloverDecision } from '@/shared/lib/rollover'
import {
  applyRolloverDecisions,
  completeTask,
  ReportDocumentRequiredError,
  setBankFeedCompleted,
  setReconciliationCompleted,
  setReportCompleted,
  SubtasksIncompleteError,
} from '@/server/work-items'

/**
 * Workstation mutations (docs/DESIGN_MANDATE.md §2: optimistic UI + server
 * actions). One entry point - the client sends the card's kind + id and this
 * dispatches to the matching engine mutation, which owns completion stamping
 * and bidirectional task↔row sync (HANDOFF §6.3).
 *
 * Results are typed and human-readable so the queue can roll back an
 * optimistic transition and show the reason verbatim in a toast.
 */

export interface WorkCardRef {
  kind: WorkCardKind
  id: number
}

export type CompleteWorkCardResult = { ok: true } | { ok: false; error: string }

export async function completeWorkCard(
  card: WorkCardRef,
  completed: boolean,
): Promise<CompleteWorkCardResult> {
  let userId: number
  try {
    const user = await requireStaff()
    userId = user.id
  } catch {
    return { ok: false, error: 'Your session expired - sign in again.' }
  }

  try {
    switch (card.kind) {
      case 'task':
        await completeTask(card.id, completed, userId)
        break
      case 'bank_feed':
        await setBankFeedCompleted(card.id, completed, userId)
        break
      case 'reconciliation':
        await setReconciliationCompleted(card.id, completed, userId)
        break
      case 'report':
        await setReportCompleted(card.id, completed, userId)
        break
    }
  } catch (error) {
    // D6/D8 lane gate: the lane reason IS the message - show it verbatim so
    // the bookkeeper sees exactly what to finish first.
    if (error instanceof BumperLaneLockedError) {
      return { ok: false, error: error.reason }
    }
    // §6.3 guard: report tasks need their report document uploaded first.
    if (error instanceof ReportDocumentRequiredError) {
      return { ok: false, error: 'Upload the report document first.' }
    }
    // B4 guard: a parent task closes only when its checklist is complete.
    if (error instanceof SubtasksIncompleteError) {
      return {
        ok: false,
        error: `${error.incompleteCount} checklist item${error.incompleteCount === 1 ? '' : 's'} still open - finish the checklist first.`,
      }
    }
    return { ok: false, error: 'Couldn’t update this item - try again.' }
  }

  revalidatePath('/workstation')
  return { ok: true }
}

// ── Guided rollover (anti-overwhelm D3) ───────────────────────────────────

export type RolloverActionResult =
  | { ok: true; applied: number; skipped: { kind: string; id: number; reason: string }[] }
  | { ok: false; error: string }

/**
 * Batch entry point behind the rollover dialog. The engine owns per-kind
 * support + assignment scope; unsupported/unassigned rows come back as
 * skips so the dialog can say exactly what happened.
 */
export async function applyRolloverAction(
  decisions: RolloverDecision[],
): Promise<RolloverActionResult> {
  let userId: number
  try {
    const user = await requireStaff()
    userId = user.id
  } catch {
    return { ok: false, error: 'Your session expired - sign in again.' }
  }
  if (!Array.isArray(decisions) || decisions.length === 0) {
    return { ok: false, error: 'Nothing to apply.' }
  }
  try {
    const result = await applyRolloverDecisions(userId, decisions)
    revalidatePath('/workstation')
    return { ok: true, applied: result.applied.length, skipped: result.skipped }
  } catch {
    return { ok: false, error: 'Couldn’t apply the rollover - try again.' }
  }
}
