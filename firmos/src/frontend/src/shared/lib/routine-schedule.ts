import {
  addDays,
  parseLocalDate,
  type ScheduleType,
} from '@firmos/domain'

/**
 * J3 (meeting #3, R1-R5, 00:39:26-00:54:05): the "Routine order and
 * frequency" schedule model - the intake's final screen. Every recurring
 * task the engagement seeds lands in one of five buckets (Daily / Weekly /
 * Monthly / Quarterly / Annual) with a per-bucket schedule, persisted to
 * form_data.routineSchedule as a map keyed by task key. Conversion
 * (server/convert.ts) turns each entry into a recurring rule through the
 * mapping here; intakes that never carry the key convert exactly as before
 * J3 (the legacy §19 defaults path).
 *
 * This module is pure and shared by the wizard screen (client), the
 * conversion (server), and both test suites - no app imports beyond the
 * vendored domain date math.
 */

// ── Buckets ───────────────────────────────────────────────────────────────

export type RoutineBucket = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual'

export const ROUTINE_BUCKETS: readonly RoutineBucket[] = [
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'annual',
]

export const ROUTINE_BUCKET_LABELS: Record<RoutineBucket, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
}

/** R4: weekday pickers render Sunday-first; values stay 0 = Sunday (§6.4). */
export const ROUTINE_WEEKDAYS: readonly { value: number; short: string; long: string }[] = [
  { value: 0, short: 'Sun', long: 'Sunday' },
  { value: 1, short: 'Mon', long: 'Monday' },
  { value: 2, short: 'Tue', long: 'Tuesday' },
  { value: 3, short: 'Wed', long: 'Wednesday' },
  { value: 4, short: 'Thu', long: 'Thursday' },
  { value: 5, short: 'Fri', long: 'Friday' },
  { value: 6, short: 'Sat', long: 'Saturday' },
]

// ── The persisted shape ───────────────────────────────────────────────────

/**
 * One card's placement + schedule. Fields are bucket-scoped:
 *  - daily: `weekdays` = the selected days (0 = Sunday .. 6 = Saturday).
 *  - weekly: `weekdays` holds the single weekday; `everyNWeeks` is the
 *    interval (1 = every week).
 *  - monthly: `dayOfMonth` (1-31), defaulted to the close tier.
 *  - quarterly: `daysAfterPeriodEnd` (1-31) - the due lands that many days
 *    after the calendar-quarter end (R4).
 *  - annual: `fiscalYearEnd` "MM-DD" (absent/null = calendar year-end,
 *    Dec 31) plus `daysAfterPeriodEnd` (1-120).
 * `keepSourceSchedule` marks cards whose source cadence the bucket model
 * cannot express (semi-annual engagements, nth-weekday custom rules):
 * conversion copies the source rule's own schedule fields verbatim and the
 * card shows a static cadence note instead of controls. Moving the card to
 * another bucket clears the flag and applies the bucket's defaults.
 */
export interface RoutineScheduleEntry {
  bucket: RoutineBucket
  /** 0-based position inside the bucket. */
  order: number
  weekdays?: number[]
  everyNWeeks?: number
  dayOfMonth?: number
  daysAfterPeriodEnd?: number
  fiscalYearEnd?: string | null
  keepSourceSchedule?: boolean
}

/** form_data.routineSchedule: task key -> placement. */
export type RoutineSchedule = Record<string, RoutineScheduleEntry>

// ── The derived card list (built by the registry, consumed here) ──────────

/**
 * One task card on the scheduler screen: what seeds at conversion plus its
 * default placement. The registry's deriveRoutineTasks builds these from the
 * intake answers, mirroring convert.ts's seeding rules one for one (the
 * standard four, the money-behavior seeds, merchant reconciliation, the
 * add-on service tasks, specialty reports, and custom recurring rules).
 */
export interface RoutineTaskDef {
  key: string
  title: string
  /** Secondary context line on the card (provider, locations, cadence). */
  detail: string | null
  /** Which seat the seeded rule belongs to. */
  assignee: 'manager' | 'bookkeeper'
  defaultEntry: RoutineScheduleEntry
  /** Seeded description (intake notes baked in at derivation time). */
  description?: string | null
  /** Specialty-report and custom-rule seeds ride the custom-rule path. */
  isCustom?: boolean
  subtasks?: string[]
  isBillable?: boolean
  unitPrice?: string | number | null
  /** The schedule fields conversion copies when keepSourceSchedule is set. */
  sourceSchedule?: {
    scheduleType: ScheduleType
    daysOfWeek?: string | null
    dayOfMonth?: number | null
    weekday?: number | null
    weekOfMonth?: number | null
    anchorMonth?: number | null
  }
}

// ── Validation + sanitization (form_data is user-controlled JSON) ─────────

export const isRoutineBucket = (v: unknown): v is RoutineBucket =>
  typeof v === 'string' && (ROUTINE_BUCKETS as readonly string[]).includes(v)

const intIn = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null

function sanitizeWeekdays(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined
  const days = [...new Set(v.filter((d): d is number => intIn(d, 0, 6) != null))].sort(
    (a, b) => a - b,
  )
  return days
}

/** Annual fiscal year-end: canonical "MM-DD"; null when absent/invalid. */
export function parseFiscalYearEnd(v: unknown): { month: number; day: number } | null {
  if (typeof v !== 'string') return null
  const m = /^(\d{2})-(\d{2})$/.exec(v.trim())
  if (!m) return null
  try {
    // 2000 is a leap year so 02-29 parses; the engine clamps the resolved
    // day to the month length on non-leap years.
    const d = parseLocalDate(`2000-${m[1]}-${m[2]}`)
    return { month: d.month, day: d.day }
  } catch {
    return null
  }
}

/** "MM-DD" canonical storage form. */
export function formatFiscalYearEnd(month: number, day: number): string {
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Field-level sanitize of one persisted entry, falling back to the task's
 * derived default per field. Unknown/extra keys drop away; an invalid bucket
 * resets the whole entry to the default (a card's bucket is its identity).
 * Bucket-scoped fields (weekdays, days, intervals) inherit the default ONLY
 * within the same bucket - a stored weekly card never inherits the derived
 * monthly default's dayOfMonth.
 */
export function sanitizeRoutineEntry(
  raw: unknown,
  fallback: RoutineScheduleEntry,
): RoutineScheduleEntry {
  if (raw == null || typeof raw !== 'object') return { ...fallback }
  const r = raw as Record<string, unknown>
  // An invalid bucket resets the whole entry - a card's bucket is its
  // identity, and partial salvage across an unknown bucket is guesswork.
  if (r.bucket !== undefined && !isRoutineBucket(r.bucket)) return { ...fallback }
  const bucket = isRoutineBucket(r.bucket) ? r.bucket : fallback.bucket
  const fieldFallback = bucket === fallback.bucket ? fallback : undefined
  const out: RoutineScheduleEntry = {
    bucket,
    order: intIn(r.order, 0, 999) ?? fieldFallback?.order ?? 0,
  }
  const weekdays = sanitizeWeekdays(r.weekdays)
  if (weekdays !== undefined) out.weekdays = weekdays
  else if (fieldFallback?.weekdays !== undefined) out.weekdays = fieldFallback.weekdays
  // An empty weekday set on a day-driven bucket is invalid input, not a
  // meaningful schedule - fall back rather than silently flipping daily to
  // "every day" at mapping time.
  if (
    (out.bucket === 'daily' || out.bucket === 'weekly') &&
    out.weekdays !== undefined &&
    out.weekdays.length === 0
  ) {
    if (fieldFallback?.weekdays !== undefined && fieldFallback.weekdays.length > 0) {
      out.weekdays = fieldFallback.weekdays
    } else {
      delete out.weekdays
    }
  }
  const everyNWeeks = intIn(r.everyNWeeks, 1, 52)
  if (everyNWeeks != null) out.everyNWeeks = everyNWeeks
  else if (fieldFallback?.everyNWeeks !== undefined) out.everyNWeeks = fieldFallback.everyNWeeks
  const dayOfMonth = intIn(r.dayOfMonth, 1, 31)
  if (dayOfMonth != null) out.dayOfMonth = dayOfMonth
  else if (fieldFallback?.dayOfMonth !== undefined) out.dayOfMonth = fieldFallback.dayOfMonth
  const daysAfter = intIn(r.daysAfterPeriodEnd, 1, 120)
  if (daysAfter != null) out.daysAfterPeriodEnd = daysAfter
  else if (fieldFallback?.daysAfterPeriodEnd !== undefined) out.daysAfterPeriodEnd = fieldFallback.daysAfterPeriodEnd
  if (r.fiscalYearEnd !== undefined) {
    out.fiscalYearEnd = parseFiscalYearEnd(r.fiscalYearEnd)
      ? String(r.fiscalYearEnd).trim()
      : null
  } else if (fieldFallback?.fiscalYearEnd !== undefined) {
    out.fiscalYearEnd = fieldFallback.fiscalYearEnd
  }
  // Absent inherits the derived default (same bucket only); an explicit false
  // (a bucket move cleared it) wins over the default.
  const keep =
    r.keepSourceSchedule === undefined
      ? fieldFallback?.keepSourceSchedule === true
      : r.keepSourceSchedule === true
  if (keep) out.keepSourceSchedule = true
  return out
}

// ── Bucket defaults + mapping to the engine's schedule fields ─────────────

/** The schedule fields a card gets when it lands in a bucket fresh (R4/R5:
 *  monthly and the period-following buckets default to the close tier day). */
export function defaultFieldsForBucket(
  bucket: RoutineBucket,
  tierDay: number,
): Omit<RoutineScheduleEntry, 'bucket' | 'order'> {
  switch (bucket) {
    case 'daily':
      return { weekdays: [1, 2, 3, 4, 5] }
    case 'weekly':
      return { weekdays: [5], everyNWeeks: 1 }
    case 'monthly':
      return { dayOfMonth: tierDay }
    case 'quarterly':
      return { daysAfterPeriodEnd: tierDay }
    case 'annual':
      return { daysAfterPeriodEnd: tierDay, fiscalYearEnd: null }
  }
}

/** The engine-side schedule shape a routine-schedule entry maps to. */
export interface RoutineRuleSchedule {
  scheduleType: ScheduleType
  daysOfWeek: string | null
  dayOfMonth: number | null
  anchorMonth: number | null
  weekInterval: number | null
}

/**
 * Entry -> §6.4 rule fields. Daily-with-a-weekday-subset rides the weekly
 * engine (the "daily" schedule type is literally every day); weekly carries
 * the J3 every-N-weeks interval; quarterly lands N days after the
 * calendar-quarter end (cadence months Jan/Apr/Jul/Oct); annual resolves the
 * (calendar or fiscal) year-end + days-following into that year's month/day.
 */
export function routineEntryToRuleSchedule(
  entry: RoutineScheduleEntry,
  ctx: { tierDay: number },
): RoutineRuleSchedule {
  switch (entry.bucket) {
    case 'daily': {
      const days = sanitizeWeekdays(entry.weekdays) ?? []
      if (days.length === 0 || days.length === 7) {
        return { scheduleType: 'daily', daysOfWeek: null, dayOfMonth: null, anchorMonth: null, weekInterval: null }
      }
      return {
        scheduleType: 'weekly',
        daysOfWeek: days.join(','),
        dayOfMonth: null,
        anchorMonth: null,
        weekInterval: null,
      }
    }
    case 'weekly': {
      const days = sanitizeWeekdays(entry.weekdays) ?? []
      const weekday = days[0] ?? 5
      const interval = intIn(entry.everyNWeeks, 1, 52) ?? 1
      return {
        scheduleType: 'weekly',
        daysOfWeek: String(weekday),
        dayOfMonth: null,
        anchorMonth: null,
        weekInterval: interval > 1 ? interval : null,
      }
    }
    case 'monthly': {
      const day = intIn(entry.dayOfMonth, 1, 31) ?? ctx.tierDay
      return { scheduleType: 'monthly', daysOfWeek: null, dayOfMonth: day, anchorMonth: null, weekInterval: null }
    }
    case 'quarterly': {
      const days = intIn(entry.daysAfterPeriodEnd, 1, 31) ?? ctx.tierDay
      // Days after the calendar-quarter end land in Jan/Apr/Jul/Oct.
      return { scheduleType: 'quarterly', daysOfWeek: null, dayOfMonth: days, anchorMonth: 1, weekInterval: null }
    }
    case 'annual': {
      const after = intIn(entry.daysAfterPeriodEnd, 1, 120) ?? ctx.tierDay
      const fiscal = parseFiscalYearEnd(entry.fiscalYearEnd)
      const base = fiscal
        ? { year: 2000, month: fiscal.month, day: fiscal.day }
        : { year: 2000, month: 12, day: 31 }
      const due = addDays(base, after)
      return {
        scheduleType: 'annual',
        daysOfWeek: null,
        dayOfMonth: due.day,
        anchorMonth: due.month,
        weekInterval: null,
      }
    }
  }
}

// ── Card summaries (the compact per-card schedule line) ───────────────────

export function routineEntrySummary(entry: RoutineScheduleEntry): string {
  switch (entry.bucket) {
    case 'daily': {
      const days = sanitizeWeekdays(entry.weekdays) ?? []
      if (days.length === 0 || days.length === 7) return 'Every day'
      return days
        .map((d) => ROUTINE_WEEKDAYS.find((w) => w.value === d)?.short ?? String(d))
        .join(', ')
    }
    case 'weekly': {
      const days = sanitizeWeekdays(entry.weekdays) ?? []
      const long = ROUTINE_WEEKDAYS.find((w) => w.value === (days[0] ?? 5))?.long ?? 'Friday'
      const interval = intIn(entry.everyNWeeks, 1, 52) ?? 1
      return interval > 1 ? `Every ${interval} weeks on ${long}` : `${long}s`
    }
    case 'monthly': {
      const day = intIn(entry.dayOfMonth, 1, 31)
      return day != null ? `Day ${day} of the month` : 'Monthly'
    }
    case 'quarterly': {
      const days = intIn(entry.daysAfterPeriodEnd, 1, 31)
      return days != null ? `${days} day${days === 1 ? '' : 's'} after the quarter ends` : 'Quarterly'
    }
    case 'annual': {
      const days = intIn(entry.daysAfterPeriodEnd, 1, 120)
      const fiscal = parseFiscalYearEnd(entry.fiscalYearEnd)
      if (days == null) return 'Annual'
      return fiscal
        ? `${days} day${days === 1 ? '' : 's'} after the fiscal year ends (${fiscal.month}/${fiscal.day})`
        : `${days} day${days === 1 ? '' : 's'} after the year ends (Dec 31)`
    }
  }
}

// ── Moves (drag-and-drop and the button/menu alternative share these) ─────

/**
 * The effective entry per derived task: the stored value sanitized onto the
 * task's default when present, the default otherwise. Keys in the stored map
 * that no answer currently derives are ignored here (conversion skips them
 * the same way), and the next screen commit drops them for good.
 */
export function resolveRoutineEntries(
  tasks: RoutineTaskDef[],
  stored: RoutineSchedule | null | undefined,
): RoutineSchedule {
  const out: RoutineSchedule = {}
  for (const t of tasks) {
    out[t.key] = sanitizeRoutineEntry(stored?.[t.key], t.defaultEntry)
  }
  return out
}

/** Task keys per bucket, sorted by entry.order (ties break by derivation order). */
export function routineBucketOrder(
  tasks: RoutineTaskDef[],
  entries: RoutineSchedule,
): Record<RoutineBucket, string[]> {
  const out: Record<RoutineBucket, string[]> = { daily: [], weekly: [], monthly: [], quarterly: [], annual: [] }
  const derivedIndex = new Map(tasks.map((t, i) => [t.key, i]))
  for (const t of tasks) {
    const entry = entries[t.key]
    if (entry) out[entry.bucket].push(t.key)
  }
  for (const bucket of ROUTINE_BUCKETS) {
    out[bucket].sort(
      (a, b) =>
        (entries[a]?.order ?? 0) - (entries[b]?.order ?? 0) ||
        (derivedIndex.get(a) ?? 0) - (derivedIndex.get(b) ?? 0),
    )
  }
  return out
}

/**
 * Move a card within or across buckets. Cross-bucket moves reset the
 * schedule fields to the target bucket's defaults (and clear
 * keepSourceSchedule) - the card's cadence IS its bucket. Within-bucket
 * moves keep every schedule field and only renumber `order`.
 */
export function moveRoutineTask(
  entries: RoutineSchedule,
  key: string,
  targetBucket: RoutineBucket,
  targetIndex: number,
  tierDay: number,
): RoutineSchedule {
  const current = entries[key]
  if (!current) return entries
  const next: RoutineSchedule = { ...entries }
  // Renumber the source bucket without the moved key.
  const sourceKeys = Object.keys(next)
    .filter((k) => k !== key && next[k]?.bucket === current.bucket)
    .sort((a, b) => (next[a]?.order ?? 0) - (next[b]?.order ?? 0))
  sourceKeys.forEach((k, i) => {
    next[k] = { ...next[k]!, order: i }
  })
  // The target bucket's keys (already renumbered when same bucket).
  const targetKeys = Object.keys(next)
    .filter((k) => k !== key && next[k]?.bucket === targetBucket)
    .sort((a, b) => (next[a]?.order ?? 0) - (next[b]?.order ?? 0))
  const clamped = Math.max(0, Math.min(targetIndex, targetKeys.length))
  targetKeys.splice(clamped, 0, key)
  targetKeys.forEach((k, i) => {
    if (k === key) {
      next[k] =
        current.bucket === targetBucket
          ? { ...current, bucket: targetBucket, order: i }
          : { ...defaultFieldsForBucket(targetBucket, tierDay), bucket: targetBucket, order: i }
    } else {
      next[k] = { ...next[k]!, order: i }
    }
  })
  return next
}

// ── The conversion plan ───────────────────────────────────────────────────

/** One recurring-rule seed planned from the schedule map. */
export interface RoutineSeedSpec {
  key: string
  title: string
  description: string | null
  assignee: 'manager' | 'bookkeeper'
  scheduleType: ScheduleType
  daysOfWeek: string | null
  dayOfMonth: number | null
  weekday: number | null
  weekOfMonth: number | null
  anchorMonth: number | null
  weekInterval: number | null
  isCustom: boolean
  subtasks: string[]
  isBillable: boolean
  unitPrice: string | number | null
}

/**
 * The conversion plan: every entry in the schedule map becomes one recurring
 * rule (R1). Keys absent from the map were removed on the screen and never
 * seed (the J3 replacement for B21's unselect); keys the answers no longer
 * derive are dropped as stale. keepSourceSchedule entries copy the source
 * cadence verbatim.
 */
export function planRoutineSeeds(
  tasks: RoutineTaskDef[],
  schedule: RoutineSchedule,
  ctx: { tierDay: number },
): RoutineSeedSpec[] {
  const out: RoutineSeedSpec[] = []
  for (const def of tasks) {
    const raw = schedule[def.key]
    if (raw == null) continue
    const entry = sanitizeRoutineEntry(raw, def.defaultEntry)
    const base = {
      key: def.key,
      title: def.title,
      description: def.description ?? null,
      assignee: def.assignee,
      isCustom: def.isCustom === true,
      subtasks: def.subtasks ?? [],
      isBillable: def.isBillable === true,
      unitPrice: def.unitPrice ?? null,
    }
    if (entry.keepSourceSchedule && def.sourceSchedule) {
      out.push({
        ...base,
        scheduleType: def.sourceSchedule.scheduleType,
        daysOfWeek: def.sourceSchedule.daysOfWeek ?? null,
        dayOfMonth: def.sourceSchedule.dayOfMonth ?? null,
        weekday: def.sourceSchedule.weekday ?? null,
        weekOfMonth: def.sourceSchedule.weekOfMonth ?? null,
        anchorMonth: def.sourceSchedule.anchorMonth ?? null,
        weekInterval: null,
      })
      continue
    }
    const shape = routineEntryToRuleSchedule(entry, ctx)
    out.push({
      ...base,
      scheduleType: shape.scheduleType,
      daysOfWeek: shape.daysOfWeek,
      dayOfMonth: shape.dayOfMonth,
      weekday: null,
      weekOfMonth: null,
      anchorMonth: shape.anchorMonth,
      weekInterval: shape.weekInterval,
    })
  }
  return out
}

/**
 * L4 (G8, 10_06 01:04:50): occurrences of a weekday set in a real month -
 * "there's five Fridays in October… but September only has four Fridays."
 * The estimate shows the honest per-month occurrence math; invoicing bills
 * the same way (recurringBillingQuantityForMonth in the domain).
 */
export function weekdayOccurrencesInMonth(year: number, month: number, weekdays: number[]): number {
  const set = new Set(weekdays)
  if (set.size === 0) return 0
  const days = new Date(year, month, 0).getDate()
  let count = 0
  for (let d = 1; d <= days; d++) {
    if (set.has(new Date(year, month - 1, d).getDay())) count++
  }
  return count
}
