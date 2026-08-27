import { weekdayOf } from '@/shared/lib/date-display'

/**
 * Workstation work-day filter (owner call notes: "my Monday clients").
 * Client-side selection over the engine's per-card clientWorkDay; the choice
 * persists per browser in localStorage under one simple key. 'all' shows
 * every client, 'any' shows only clients with no assigned work day.
 */

export type WorkDaySelection = number | 'any' | 'all'

const STORAGE_KEY = 'firmos.workstation.workDay.v1'

/** Default: today's weekday (Mon-Fri); weekends fall back to 'all'. */
export function defaultWorkDay(todayIso: string): WorkDaySelection {
  const day = weekdayOf(todayIso)
  return day >= 1 && day <= 5 ? day : 'all'
}

export function loadWorkDay(fallback: WorkDaySelection): WorkDaySelection {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw == null) return fallback
    if (raw === 'all' || raw === 'any') return raw
    const n = Number(raw)
    return Number.isInteger(n) && n >= 0 && n <= 6 ? n : fallback
  } catch {
    return fallback
  }
}

export function persistWorkDay(selection: WorkDaySelection): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(selection))
  } catch {
    // Storage blocked - the choice just won't persist across reloads.
  }
}
