'use server'

import { revalidatePath } from 'next/cache'

import { requireStaff } from '@/server/auth/guards'
import type { WorkCardKind } from '@/server/queue'
import {
  completeTask,
  ReportDocumentRequiredError,
  setBankFeedCompleted,
  setReconciliationCompleted,
  setReportCompleted,
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
    // §6.3 guard: report tasks need their report document uploaded first.
    if (error instanceof ReportDocumentRequiredError) {
      return { ok: false, error: 'Upload the report document first.' }
    }
    return { ok: false, error: 'Couldn’t update this item - try again.' }
  }

  revalidatePath('/workstation')
  return { ok: true }
}
