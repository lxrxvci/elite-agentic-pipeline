'use client'

import * as React from 'react'
import { CalendarClock, LayoutTemplate, ListChecks, Plus, StickyNote, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { quickAddOptionsAction } from '@/server/actions/quick-add'
import type { QuickAddOptions } from '@/server/quick-add'

import {
  LogMeetingDialog,
  QuickNoteDialog,
  QuickTaskDialog,
  TemplateTaskDialog,
} from './quick-add-dialogs'

/**
 * The owner's "Y button": a plus button in the top bar that opens four fast
 * capture flows - quick note, new task, task from template, log meeting.
 * Open with the button, the global `n` key (outside text fields), or the
 * cmd+k palette (which drives the same dialogs through the controlled
 * `dialog` prop, owned by the top bar).
 *
 * Picker data (active clients / staff / ad-hoc templates) loads lazily on
 * first open and is cached for the session.
 */

export type QuickAddKind = 'note' | 'task' | 'template' | 'meeting'

export const QUICK_ADD_ITEMS: { kind: QuickAddKind; label: string; hint: string; icon: LucideIcon }[] = [
  { kind: 'note', label: 'Quick note', hint: 'Sticky note, optionally on a client', icon: StickyNote },
  { kind: 'task', label: 'New task', hint: 'One-off task with subtasks', icon: ListChecks },
  { kind: 'template', label: 'Task from template', hint: 'Mint from an ad-hoc template', icon: LayoutTemplate },
  { kind: 'meeting', label: 'Log meeting', hint: 'Completed task plus time, maybe billable', icon: CalendarClock },
]

export function QuickAddMenu({
  dialog,
  onDialogChange,
}: {
  dialog: QuickAddKind | null
  onDialogChange: (dialog: QuickAddKind | null) => void
}) {
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [options, setOptions] = React.useState<QuickAddOptions | null>(null)
  const loadingRef = React.useRef(false)

  const ensureOptions = React.useCallback(async () => {
    if (options != null || loadingRef.current) return
    loadingRef.current = true
    try {
      const res = await quickAddOptionsAction()
      if (res.ok) {
        setOptions(res.data)
      } else {
        toast.error(res.error)
      }
    } finally {
      loadingRef.current = false
    }
  }, [options])

  // Global `n` opens the menu (mirrors the `/` cmd+k trigger in the shell).
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      if (typing) return
      e.preventDefault()
      setMenuOpen(true)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  React.useEffect(() => {
    if (menuOpen || dialog != null) void ensureOptions()
  }, [menuOpen, dialog, ensureOptions])

  const pick = (kind: QuickAddKind) => {
    setMenuOpen(false)
    onDialogChange(kind)
  }

  const dialogProps = (kind: QuickAddKind) => ({
    open: dialog === kind,
    onOpenChange: (open: boolean) => onDialogChange(open ? kind : null),
    options,
  })

  return (
    <>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Quick add"
            title="Quick add (N)"
            data-testid="quick-add-trigger"
            className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm transition-colors duration-150 ease-out hover:bg-primary/90 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Plus aria-hidden className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-1">
          <p className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Quick add
          </p>
          {QUICK_ADD_ITEMS.map((item) => (
            <button
              key={item.kind}
              type="button"
              onClick={() => pick(item.kind)}
              data-testid={`quick-add-${item.kind}`}
              className="flex w-full items-start gap-2.5 rounded-sm px-2 py-1.5 text-left outline-none transition-colors duration-150 hover:bg-accent focus-visible:bg-accent"
            >
              <item.icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{item.label}</span>
                <span className="block text-[11px] text-muted-foreground">{item.hint}</span>
              </span>
            </button>
          ))}
        </PopoverContent>
      </Popover>

      <QuickNoteDialog {...dialogProps('note')} />
      <QuickTaskDialog {...dialogProps('task')} />
      <TemplateTaskDialog {...dialogProps('template')} />
      <LogMeetingDialog {...dialogProps('meeting')} />
    </>
  )
}
