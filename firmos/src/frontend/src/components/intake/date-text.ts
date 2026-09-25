/**
 * Masked MM/DD/YYYY text entry for intake date fields (intake-restructure
 * I1, plan §3: dates are typed text - no calendar popups). The wizard stores
 * ISO "YYYY-MM-DD" exactly like the old pickers did; these helpers are the
 * only mask/parse points so every `date-text` field behaves identically.
 *
 * Pure string math only - never `new Date("YYYY-MM-DD")` (§30 date policy).
 */

/** Digits only, capped at 8 (MMDDYYYY). */
export function dateTextDigits(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 8)
}

/** Progressive mask while typing: "1" -> "1", "121" -> "12/1", "01052026" -> "01/05/2026". */
export function maskDateText(raw: string): string {
  const d = dateTextDigits(raw)
  if (d.length <= 2) return d
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

const isLeap = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

/** Complete "MM/DD/YYYY" -> ISO "YYYY-MM-DD"; null when incomplete or not a real date. */
export function dateTextToIso(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim())
  if (!m) return null
  const month = Number(m[1])
  const day = Number(m[2])
  const year = Number(m[3])
  if (month < 1 || month > 12) return null
  if (year < 1900 || year > 2100) return null
  const maxDay = (DAYS_IN_MONTH[month - 1] ?? 0) + (month === 2 && isLeap(year) ? 1 : 0)
  if (day < 1 || day > maxDay) return null
  return `${m[3]}-${m[1]}-${m[2]}`
}

/** ISO "YYYY-MM-DD" -> "MM/DD/YYYY" for the input's initial display. */
export function isoToDateText(iso: string | null | undefined): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null
  return m ? `${m[2]}/${m[3]}/${m[1]}` : ''
}

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

/** "Jan 5, 2026" - review-screen label for an ISO date; null for missing/invalid. */
export function dateTextLabel(iso: unknown): string | null {
  if (typeof iso !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  const month = Number(m[2])
  const name = MONTH_SHORT[month - 1]
  if (!name) return null
  return `${name} ${Number(m[3])}, ${m[1]}`
}
