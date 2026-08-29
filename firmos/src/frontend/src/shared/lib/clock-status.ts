'use client'

import { useSyncExternalStore } from 'react'

import type { ClockStatus } from '@/server/time-tracking'

/**
 * Shared clock-status store (fixes the per-card N+1: every TaskTimerToggle
 * used to fire its own getClockStatusAction on mount, so a page of task
 * cards issued dozens of identical reads). One poller, many subscribers.
 * The action module is dynamically imported so jsdom tests that render
 * consumer rows without the time-action mocks keep working.
 */
export type { ClockStatus }

const POLL_MS = 30_000

let status: ClockStatus | null = null
let inflight: Promise<void> | null = null
let timer: ReturnType<typeof setInterval> | null = null
let generation = 0
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export async function refreshClockStatus(): Promise<void> {
  const atGeneration = generation
  inflight ??= import('@/server/actions/time')
    .then((m) => m.getClockStatusAction())
    .then((r) => {
      // A reset during the flight discards the stale write.
      if (r.ok && atGeneration === generation) {
        status = r.data
        emit()
      }
    })
    .catch(() => {
      // Offline or unmocked in tests: keep the last known status.
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    void refreshClockStatus()
    timer = setInterval(() => void refreshClockStatus(), POLL_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

function getSnapshot(): ClockStatus | null {
  return status
}

const getServerSnapshot = (): ClockStatus | null => null

/** Test hook: reset the module singleton between specs. */
export function __resetClockStatusForTests(): void {
  status = null
  inflight = null
  generation += 1
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  listeners.clear()
}

/** Subscribe to the shared clock status; null until the first read lands. */
export function useClockStatus(): ClockStatus | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
