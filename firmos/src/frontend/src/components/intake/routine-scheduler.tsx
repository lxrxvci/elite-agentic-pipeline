'use client'

import { useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowRight, ArrowUp, ChevronDown, GripVertical, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DEFAULT_RULE_KEYS } from '@/shared/lib/default-rules'
import {
  ROUTINE_BUCKET_LABELS,
  ROUTINE_BUCKETS,
  ROUTINE_WEEKDAYS,
  formatFiscalYearEnd,
  moveRoutineTask,
  parseFiscalYearEnd,
  resolveRoutineEntries,
  routineBucketOrder,
  routineEntrySummary,
  type RoutineBucket,
  type RoutineSchedule,
  type RoutineScheduleEntry,
  type RoutineTaskDef,
} from '@/shared/lib/routine-schedule'
import { cn } from '@/shared/lib/utils'

import { inputCls } from './account-screens'
import { closeTierDay, deriveRoutineTasks, type QuestionDef, type WizardAnswers } from './registry'

/**
 * J3 (meeting #3, R1-R5, 00:39:26-00:54:05): the "Routine order and
 * frequency" screen - the intake's final content screen. Five cadence
 * buckets; every card is a recurring task the engagement seeds at
 * conversion. Drag-and-drop reorders within a bucket and moves between
 * buckets (@dnd-kit); the same moves are available from the keyboard via
 * each card's up/down buttons and bucket picker. Schedule controls are
 * bucket-specific (R4): daily = weekday multi-select, weekly = weekday +
 * every-N-weeks, monthly = day of month (default = the close tier day),
 * quarterly = days after the calendar-quarter end, annual = calendar vs
 * fiscal year-end + days following (R5: due dates settle during intake).
 *
 * The persisted truth is form_data.routineSchedule; every edit commits
 * through the wizard's apply path so autosave and resume behave like any
 * other screen. The visible list always derives from the current answers -
 * stored entries for tasks the answers no longer produce are dropped on the
 * next commit.
 */

// ── Small controlled inputs ───────────────────────────────────────────────

/** Number entry with a local typing buffer; only in-range integers commit. */
function ScheduleNumberInput({
  label,
  value,
  min,
  max,
  onCommit,
  testid,
}: {
  label: string
  value: number
  min: number
  max: number
  onCommit: (n: number) => void
  testid?: string
}) {
  const [text, setText] = useState(String(value))
  const [focused, setFocused] = useState(false)
  return (
    <input
      aria-label={label}
      data-testid={testid}
      className={cn(inputCls, 'tnum h-9 w-20 px-2')}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={focused ? text : String(value)}
      onFocus={() => {
        setText(String(value))
        setFocused(true)
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number(e.target.value)
        if (Number.isInteger(n) && n >= min && n <= max) onCommit(n)
      }}
    />
  )
}

/** Fiscal year-end as MM/DD text (stored canonical "MM-DD"). */
function FiscalYearEndInput({
  value,
  onCommit,
  testid,
}: {
  value: string | null | undefined
  onCommit: (mmdd: string | null) => void
  testid?: string
}) {
  const parsed = parseFiscalYearEnd(value)
  const [text, setText] = useState(parsed ? `${String(parsed.month).padStart(2, '0')}/${String(parsed.day).padStart(2, '0')}` : '')
  const [invalid, setInvalid] = useState(false)
  return (
    <span className="inline-flex flex-col gap-1">
      <input
        aria-label="Fiscal year-end (MM/DD)"
        data-testid={testid}
        aria-invalid={invalid}
        className={cn(inputCls, 'tnum h-9 w-24 px-2')}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="06/30"
        value={text}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 4)
          const masked = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits
          setText(masked)
          if (digits.length < 4) {
            setInvalid(false)
            onCommit(null)
            return
          }
          const candidate = `${digits.slice(0, 2)}-${digits.slice(2)}`
          const ok = parseFiscalYearEnd(candidate) != null
          setInvalid(!ok)
          onCommit(ok ? candidate : null)
        }}
      />
      {invalid && (
        <span className="text-xs font-medium text-status-overdue" role="alert">
          Use a real date as MM/DD.
        </span>
      )}
    </span>
  )
}

// ── Weekday chips ─────────────────────────────────────────────────────────

/** Sunday-first weekday chips (R4); multi (daily) or single-pick (weekly). */
function WeekdayChips({
  label,
  selected,
  single,
  onChange,
  testidPrefix,
}: {
  label: string
  selected: number[]
  single: boolean
  onChange: (days: number[]) => void
  testidPrefix: string
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {ROUTINE_WEEKDAYS.map((d) => {
        const on = selected.includes(d.value)
        return (
          <button
            key={d.value}
            type="button"
            aria-pressed={on}
            data-testid={`${testidPrefix}-${d.value}`}
            data-selected={on || undefined}
            onClick={() => {
              if (single) {
                onChange([d.value])
              } else {
                onChange(
                  on ? selected.filter((v) => v !== d.value) : [...selected, d.value].sort((a, b) => a - b),
                )
              }
            }}
            className={cn(
              'h-8 min-w-11 rounded-md border px-2 text-xs font-semibold transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              on
                ? 'border-firm-brand bg-accent text-accent-foreground'
                : 'border-border bg-card text-muted-foreground hover:border-firm-brand/60 hover:text-foreground',
            )}
          >
            {d.short}
          </button>
        )
      })}
    </div>
  )
}

// ── Per-bucket schedule controls ──────────────────────────────────────────

function ScheduleControls({
  task,
  entry,
  onPatch,
}: {
  task: RoutineTaskDef
  entry: RoutineScheduleEntry
  onPatch: (patch: Partial<RoutineScheduleEntry>) => void
}) {
  if (entry.keepSourceSchedule) {
    return (
      <p className="text-xs text-muted-foreground" role="note" data-testid={`keep-schedule-${task.key}`}>
        Runs on its own {entry.bucket === 'annual' ? 'twice-a-year or anchored' : 'anchored'} cadence
        {task.detail ? ` (${task.detail})` : ''} - move it to another bucket to set a new schedule.
      </p>
    )
  }
  switch (entry.bucket) {
    case 'daily':
      return (
        <WeekdayChips
          label={`Days of the week for ${task.title}`}
          selected={entry.weekdays ?? []}
          single={false}
          onChange={(days) => onPatch({ weekdays: days })}
          testidPrefix={`weekday-${task.key}`}
        />
      )
    case 'weekly':
      return (
        <div className="space-y-2.5">
          <WeekdayChips
            label={`Weekday for ${task.title}`}
            selected={entry.weekdays ?? []}
            single
            onChange={(days) => onPatch({ weekdays: days })}
            testidPrefix={`weekday-${task.key}`}
          />
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>every</span>
            <ScheduleNumberInput
              label={`Every N weeks for ${task.title}`}
              value={entry.everyNWeeks ?? 1}
              min={1}
              max={8}
              onCommit={(n) => onPatch({ everyNWeeks: n })}
              testid={`every-n-weeks-${task.key}`}
            />
            <span>{(entry.everyNWeeks ?? 1) === 1 ? 'week' : 'weeks'}</span>
          </div>
        </div>
      )
    case 'monthly':
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Day</span>
          <ScheduleNumberInput
            label={`Day of the month for ${task.title}`}
            value={entry.dayOfMonth ?? 15}
            min={1}
            max={31}
            onCommit={(n) => onPatch({ dayOfMonth: n })}
            testid={`day-of-month-${task.key}`}
          />
          <span>of the month</span>
        </div>
      )
    case 'quarterly':
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ScheduleNumberInput
            label={`Days after the quarter ends for ${task.title}`}
            value={entry.daysAfterPeriodEnd ?? 15}
            min={1}
            max={31}
            onCommit={(n) => onPatch({ daysAfterPeriodEnd: n })}
            testid={`days-after-${task.key}`}
          />
          <span>days after the calendar quarter ends</span>
        </div>
      )
    case 'annual': {
      const fiscal = parseFiscalYearEnd(entry.fiscalYearEnd)
      return (
        <div className="space-y-2.5">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Year-end basis for ${task.title}`}>
            {[
              { value: 'calendar', label: 'Calendar year-end (Dec 31)' },
              { value: 'fiscal', label: 'Fiscal year-end' },
            ].map((o) => {
              const on = o.value === 'fiscal' ? fiscal != null : fiscal == null
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={on}
                  data-testid={`yearend-${o.value}-${task.key}`}
                  data-selected={on || undefined}
                  onClick={() =>
                    onPatch({
                      // Switching to fiscal starts at the common June 30.
                      fiscalYearEnd: o.value === 'fiscal' ? formatFiscalYearEnd(6, 30) : null,
                    })
                  }
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    on
                      ? 'border-firm-brand bg-accent text-accent-foreground'
                      : 'border-border bg-card text-foreground hover:border-firm-brand/60 hover:bg-accent/50',
                  )}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {fiscal != null && (
              <FiscalYearEndInput
                value={entry.fiscalYearEnd}
                onCommit={(mmdd) => onPatch({ fiscalYearEnd: mmdd })}
                testid={`fiscal-yearend-${task.key}`}
              />
            )}
            <ScheduleNumberInput
              label={`Days after the year end for ${task.title}`}
              value={entry.daysAfterPeriodEnd ?? 15}
              min={1}
              max={120}
              onCommit={(n) => onPatch({ daysAfterPeriodEnd: n })}
              testid={`days-after-${task.key}`}
            />
            <span>days after the {fiscal ? 'fiscal' : 'calendar'} year ends</span>
          </div>
        </div>
      )
    }
  }
}

// ── The task card ─────────────────────────────────────────────────────────

function RoutineTaskCard({
  task,
  entry,
  index,
  bucketKeys,
  dragging,
  controlsOpen,
  removable,
  onToggleControls,
  onMove,
  onRemove,
  onPatch,
}: {
  task: RoutineTaskDef
  entry: RoutineScheduleEntry
  index: number
  bucketKeys: string[]
  dragging: boolean
  controlsOpen: boolean
  /** Only the four standard routines un-seed from here (B21 exclusions). */
  removable: boolean
  onToggleControls: () => void
  onMove: (bucket: RoutineBucket, index: number) => void
  onRemove: () => void
  onPatch: (patch: Partial<RoutineScheduleEntry>) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.key,
  })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid={`routine-card-${task.key}`}
      data-bucket={entry.bucket}
      className={cn(
        'rounded-xl border border-border bg-card px-3.5 py-3 shadow-card transition-opacity',
        (isDragging || dragging) && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-2">
        {/* The drag handle; the same moves are on the buttons beside it. */}
        <button
          type="button"
          aria-label={`Drag ${task.title} to reorder or move`}
          className="mt-0.5 cursor-grab touch-none rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{task.title}</p>
          <p className="mt-0.5 truncate text-xs" data-testid={`schedule-summary-${task.key}`}>
            <span className="font-medium text-firm-brand-strong">
              {entry.keepSourceSchedule
                ? `${task.detail ?? ROUTINE_BUCKET_LABELS[entry.bucket]} cadence`
                : routineEntrySummary(entry)}
            </span>
            <span className="text-muted-foreground">
              {' '}
              · {task.assignee === 'manager' ? 'Manager' : 'Bookkeeper'}
              {task.detail && !entry.keepSourceSchedule ? ` · ${task.detail}` : ''}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={`Move ${task.title} up`}
            disabled={index === 0}
            onClick={() => onMove(entry.bucket, index - 1)}
            data-testid={`move-up-${task.key}`}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          >
            <ArrowUp className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={`Move ${task.title} down`}
            disabled={index === bucketKeys.length - 1}
            onClick={() => onMove(entry.bucket, index + 1)}
            data-testid={`move-down-${task.key}`}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden />
          </button>
          <select
            aria-label={`Move ${task.title} to another bucket`}
            data-testid={`move-bucket-${task.key}`}
            className="h-8 rounded-md border border-input bg-background px-1.5 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            value={entry.bucket}
            onChange={(e) => onMove(e.target.value as RoutineBucket, Number.MAX_SAFE_INTEGER)}
          >
            {ROUTINE_BUCKETS.map((b) => (
              <option key={b} value={b}>
                {ROUTINE_BUCKET_LABELS[b]}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={`${controlsOpen ? 'Close' : 'Set'} the schedule for ${task.title}`}
            aria-expanded={controlsOpen}
            data-testid={`schedule-toggle-${task.key}`}
            onClick={onToggleControls}
            className={cn(
              'rounded p-1.5 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              controlsOpen ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <ChevronDown
              className={cn('h-3.5 w-3.5 transition-transform', controlsOpen && 'rotate-180')}
              aria-hidden
            />
          </button>
          {removable && (
            <button
              type="button"
              aria-label={`Remove ${task.title} from the schedule`}
              data-testid={`remove-${task.key}`}
              onClick={onRemove}
              className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-status-overdue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>
      {controlsOpen && (
        <div
          // Remount on a bucket move so buffered inputs never show stale text.
          key={entry.bucket}
          className="mt-3 rounded-lg border border-border bg-muted/40 px-3.5 py-3"
          data-testid={`schedule-controls-${task.key}`}
        >
          <ScheduleControls task={task} entry={entry} onPatch={onPatch} />
        </div>
      )}
    </li>
  )
}

// ── The screen ────────────────────────────────────────────────────────────

export function RoutineSchedulerScreen({
  q,
  answers,
  onApply,
  onAdvance,
}: {
  q: QuestionDef
  answers: WizardAnswers
  onApply: (patch: Partial<WizardAnswers>) => void
  onAdvance: () => void
}) {
  const tierDay = closeTierDay(answers)
  const tasks = deriveRoutineTasks(answers)
  const entries = resolveRoutineEntries(tasks, answers.routineSchedule)
  const order = routineBucketOrder(tasks, entries)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [openControls, setOpenControls] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const commit = (next: RoutineSchedule) => onApply(q.apply(answers, next))

  const move = (key: string, bucket: RoutineBucket, index: number) => {
    setError(null)
    commit(moveRoutineTask(entries, key, bucket, index, tierDay))
  }

  const patchEntry = (key: string, patch: Partial<RoutineScheduleEntry>) => {
    const current = entries[key]
    if (!current) return
    commit({ ...entries, [key]: { ...current, ...patch } })
  }

  const removeTask = (key: string) => {
    // The J3 form of B21's unselect: only the four standard routines are
    // removable here, and removal persists as an exclusion (the same key the
    // legacy conversion path honors) - the card never derives again.
    const next = { ...entries }
    delete next[key]
    onApply({
      ...q.apply(answers, next),
      excludedDefaultRules: [...(answers.excludedDefaultRules ?? []), key],
    })
  }

  const onDragStart = (e: DragStartEvent) => setActiveKey(String(e.active.id))

  const onDragEnd = (e: DragEndEvent) => {
    setActiveKey(null)
    const key = String(e.active.id)
    const over = e.over
    if (!over || !entries[key]) return
    const overId = String(over.id)
    if (overId.startsWith('bucket:')) {
      // Dropped on a bucket's empty area: append to it (no-op when same).
      const bucket = overId.slice('bucket:'.length) as RoutineBucket
      if (entries[key].bucket !== bucket) move(key, bucket, order[bucket].length)
      return
    }
    if (overId === key || !entries[overId]) return
    const targetBucket = entries[overId].bucket
    const overIndex = order[targetBucket].indexOf(overId)
    // moveRoutineTask removes the card before splicing, which is exactly
    // arrayMove(from, overIndex) for same-bucket drops and "insert before
    // the target card" for cross-bucket drops.
    if (entries[key].bucket === targetBucket && order[targetBucket].indexOf(key) === overIndex) return
    move(key, targetBucket, overIndex)
  }

  const finish = () => {
    for (const t of tasks) {
      const entry = entries[t.key]
      if (!entry || entry.keepSourceSchedule) continue
      if ((entry.bucket === 'daily' || entry.bucket === 'weekly') && (entry.weekdays ?? []).length === 0) {
        setError(`Pick at least one day of the week for "${t.title}".`)
        return
      }
    }
    setError(null)
    commit(entries)
    onAdvance()
  }

  const activeTask = activeKey ? (tasks.find((t) => t.key === activeKey) ?? null) : null

  return (
    <div className="space-y-4" data-testid="routine-scheduler">
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        {/* Buckets stack full-width: the per-card controls need the room. */}
        <div className="space-y-3">
          {ROUTINE_BUCKETS.map((bucket) => (
            <BucketSection
              key={bucket}
              bucket={bucket}
              tasks={tasks}
              entries={entries}
              keys={order[bucket]}
              activeKey={activeKey}
              openControls={openControls}
              onToggleControls={(key) => setOpenControls((o) => ({ ...o, [key]: !o[key] }))}
              onMove={move}
              onRemove={removeTask}
              onPatch={patchEntry}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask ? (
            <div className="rounded-xl border border-firm-brand bg-card px-4 py-3 shadow-pop">
              <p className="text-sm font-medium text-foreground">{activeTask.title}</p>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {error && (
        <p className="text-sm font-medium text-status-overdue" role="alert">
          {error}
        </p>
      )}

      <Button type="button" variant="action" onClick={finish} data-testid="continue">
        Continue
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  )
}

function BucketSection({
  bucket,
  tasks,
  entries,
  keys,
  activeKey,
  openControls,
  onToggleControls,
  onMove,
  onRemove,
  onPatch,
}: {
  bucket: RoutineBucket
  tasks: RoutineTaskDef[]
  entries: RoutineSchedule
  keys: string[]
  activeKey: string | null
  openControls: Record<string, boolean>
  onToggleControls: (key: string) => void
  onMove: (key: string, bucket: RoutineBucket, index: number) => void
  onRemove: (key: string) => void
  onPatch: (key: string, patch: Partial<RoutineScheduleEntry>) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `bucket:${bucket}` })
  const byKey = new Map(tasks.map((t) => [t.key, t]))
  return (
    <section
      data-testid={`bucket-${bucket}`}
      aria-label={`${ROUTINE_BUCKET_LABELS[bucket]} bucket`}
      className={cn(
        'rounded-xl border border-border bg-muted/30 p-3 transition-colors',
        isOver && 'border-firm-brand/60 bg-accent/40',
      )}
    >
      <h2 className="flex items-baseline justify-between gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {ROUTINE_BUCKET_LABELS[bucket]}
        <span className="font-normal normal-case tracking-normal" data-testid={`bucket-count-${bucket}`}>
          {keys.length === 0 ? 'empty' : `${keys.length} task${keys.length === 1 ? '' : 's'}`}
        </span>
      </h2>
      <SortableContext items={keys} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className="mt-2 min-h-10 space-y-2" aria-label={`${ROUTINE_BUCKET_LABELS[bucket]} tasks`}>
          {keys.map((key, index) => {
            const task = byKey.get(key)
            const entry = entries[key]
            if (!task || !entry) return null
            return (
              <RoutineTaskCard
                key={key}
                task={task}
                entry={entry}
                index={index}
                bucketKeys={keys}
                dragging={activeKey === key}
                controlsOpen={openControls[key] === true}
                removable={DEFAULT_RULE_KEYS.includes(key)}
                onToggleControls={() => onToggleControls(key)}
                onMove={(b, i) => onMove(key, b, i)}
                onRemove={() => onRemove(key)}
                onPatch={(patch) => onPatch(key, patch)}
              />
            )
          })}
          {keys.length === 0 && (
            <li className="rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
              Nothing {ROUTINE_BUCKET_LABELS[bucket].toLowerCase()} yet - drag a routine here.
            </li>
          )}
        </ul>
      </SortableContext>
    </section>
  )
}
