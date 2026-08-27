'use client'

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Paperclip, SendHorizonal, X } from 'lucide-react'

import type { ChatPerson } from '@/server/chat'
import { cn } from '@/shared/lib/utils'

/**
 * Message composer. Enter sends, Shift+Enter inserts a newline. Typing "@"
 * opens a member typeahead; picking a name inserts the display form and
 * remembers the id, so the wire body carries the §16 @(id) mention form.
 * One attachment per message, validated server side (§13 layers).
 */

interface ComposerProps {
  members: ChatPerson[]
  meId: number
  disabled?: boolean
  /** Returns true when the send succeeded; on false the draft is restored. */
  onSend: (displayBody: string, wireBody: string, file: File | null) => Promise<boolean>
}

interface MentionTarget {
  /** Index of the "@" in the textarea value. */
  start: number
  query: string
}

function mentionTargetAt(value: string, caret: number): MentionTarget | null {
  const before = value.slice(0, caret)
  const match = /(?:^|[\s(])@([A-Za-z ]*)$/.exec(before)
  if (!match) return null
  return { start: caret - match[1].length - 1, query: match[1] }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function Composer({ members, meId, disabled, onSend }: ComposerProps) {
  const [value, setValue] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [target, setTarget] = useState<MentionTarget | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  /** Display name -> user id, for names picked from the typeahead. */
  const pickedMentionsRef = useRef(new Map<string, number>())
  /** Caret position to apply after the next committed value change. */
  const pendingCaretRef = useRef<number | null>(null)

  // Apply a pending caret AFTER React commits the new value; setting it in
  // the same tick as setState races the controlled-textarea restore.
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (el && pendingCaretRef.current != null) {
      const pos = pendingCaretRef.current
      pendingCaretRef.current = null
      el.focus()
      el.setSelectionRange(pos, pos)
    }
  }, [value])

  const candidates = useMemo(() => {
    if (!target) return []
    const q = target.query.trim().toLowerCase()
    return members
      .filter((m) => m.id !== meId)
      .filter((m) => q === '' || m.name.toLowerCase().includes(q))
      .slice(0, 6)
  }, [members, meId, target])

  const typeaheadOpen = target != null && candidates.length > 0

  const refreshTarget = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    setTarget(mentionTargetAt(el.value, el.selectionStart ?? el.value.length))
    setActiveIndex(0)
  }, [])

  const pickMention = useCallback(
    (person: ChatPerson) => {
      const el = textareaRef.current
      if (!el || !target) return
      const caret = el.selectionStart ?? el.value.length
      const inserted = `@${person.name} `
      const next = el.value.slice(0, target.start) + inserted + el.value.slice(caret)
      pickedMentionsRef.current.set(person.name, person.id)
      pendingCaretRef.current = target.start + inserted.length
      setValue(next)
      setTarget(null)
    },
    [target],
  )

  /** Display body -> wire body: picked @Name mentions become @(id) (§16). */
  const encodeMentions = useCallback((body: string): string => {
    let out = body
    const entries = [...pickedMentionsRef.current.entries()].sort(
      (a, b) => b[0].length - a[0].length,
    )
    for (const [name, id] of entries) {
      out = out.replace(new RegExp(`@${escapeRegExp(name)}(?=\\s|$)`, 'g'), `@(${id})`)
    }
    return out
  }, [])

  const submit = useCallback(async () => {
    const displayBody = value.trim()
    if ((displayBody === '' && !file) || sending) return
    const sentFile = file
    setSending(true)
    setValue('')
    setFile(null)
    setTarget(null)
    const ok = await onSend(displayBody, encodeMentions(displayBody), sentFile)
    setSending(false)
    if (!ok) {
      setValue(displayBody)
      setFile(sentFile)
    } else {
      pickedMentionsRef.current.clear()
    }
    textareaRef.current?.focus()
  }, [value, file, sending, onSend, encodeMentions])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (typeaheadOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => (i + 1) % candidates.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => (i - 1 + candidates.length) % candidates.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pickMention(candidates[activeIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setTarget(null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <div className="border-t border-border bg-card px-4 py-3">
      {file && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-[12px]">
          <Paperclip aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium text-foreground">{file.name}</span>
          <span className="tnum text-muted-foreground">
            {(file.size / 1024 / 1024).toFixed(1)} MB
          </span>
          <button
            type="button"
            aria-label="Remove attachment"
            onClick={() => setFile(null)}
            className="ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X aria-hidden className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="relative flex items-end gap-2">
        {typeaheadOpen && (
          <div
            role="listbox"
            aria-label="Mention a person"
            className="absolute bottom-full left-0 mb-2 w-64 overflow-hidden rounded-md border border-border bg-popover shadow-md"
          >
            {candidates.map((person, i) => (
              <button
                key={person.id}
                type="button"
                role="option"
                aria-selected={i === activeIndex}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pickMention(person)
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-[13px]',
                  i === activeIndex ? 'bg-accent/60' : 'hover:bg-secondary',
                )}
              >
                <span
                  aria-hidden
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-muted-foreground"
                >
                  {person.initials}
                </span>
                <span className="truncate font-medium text-foreground">{person.name}</span>
                <span className="ml-auto shrink-0 text-[11px] capitalize text-muted-foreground">
                  {person.role}
                </span>
              </button>
            ))}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            const picked = e.target.files?.[0] ?? null
            setFile(picked)
            e.target.value = ''
            textareaRef.current?.focus()
          }}
        />
        <button
          type="button"
          aria-label="Attach a file"
          title="Attach a file (up to 50 MB)"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground disabled:opacity-50"
        >
          <Paperclip aria-hidden className="h-4 w-4" />
        </button>

        <textarea
          ref={textareaRef}
          value={value}
          disabled={disabled}
          onChange={(e) => {
            setValue(e.target.value)
            requestAnimationFrame(refreshTarget)
          }}
          onClick={refreshTarget}
          onKeyDown={onKeyDown}
          onBlur={() => {
            // Delay so a typeahead mousedown can land first.
            setTimeout(() => setTarget(null), 150)
          }}
          rows={1}
          placeholder="Write a message. @ to mention, Enter to send."
          aria-label="Message"
          className="max-h-36 min-h-9 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-[13px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        />
        <button
          type="button"
          aria-label="Send message"
          onClick={() => void submit()}
          disabled={disabled || sending || (value.trim() === '' && !file)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors duration-150 hover:bg-primary/90 disabled:opacity-50"
        >
          {sending ? (
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          ) : (
            <SendHorizonal aria-hidden className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  )
}
