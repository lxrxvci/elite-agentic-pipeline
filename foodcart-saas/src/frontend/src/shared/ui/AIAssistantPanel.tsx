'use client'

import { useState, useRef, useEffect } from 'react'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChangePreview {
  summary: string
  added: string[]
  removed: string[]
}

interface AIAssistantPanelProps {
  open: boolean
  onClose: () => void
  messages: ChatMessage[]
  preview?: ChangePreview | null
  loading?: boolean
  guardrailError?: string | null
  onSend: (text: string) => void
  onApprove: () => void
  onReject: () => void
}

export function AIAssistantPanel({
  open,
  onClose,
  messages,
  preview,
  loading,
  guardrailError,
  onSend,
  onApprove,
  onReject,
}: AIAssistantPanelProps) {
  const [text, setText] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, preview, loading])

  if (!open) return null

  return (
    <section
      aria-label="AI Website Assistant"
      className="fixed inset-y-0 right-0 z-50 w-full sm:w-[26rem] border-l border-fc-neutral-200 bg-white flex flex-col shadow-elevated"
    >
      <header className="h-14 px-4 flex items-center justify-between border-b border-fc-neutral-200 bg-fc-neutral-50">
        <span className="font-semibold text-fc-text-primary">🤖 AI Website Assistant</span>
        <button
          type="button"
          aria-label="Close assistant"
          onClick={onClose}
          className="text-fc-text-secondary hover:text-fc-text-primary p-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fc-cobalt-500"
        >
          ×
        </button>
      </header>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-4"
        aria-live="polite"
        aria-atomic="false"
      >
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'ml-8' : 'mr-8'}>
            <div
              className={`rounded-2xl px-4 py-3 text-sm ${
                m.role === 'user'
                  ? 'bg-fc-cobalt-600 text-white'
                  : 'bg-fc-neutral-100 text-fc-text-primary'
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="mr-8">
            <div className="rounded-2xl px-4 py-3 text-sm bg-fc-neutral-100 text-fc-text-primary inline-flex gap-1" aria-label="Assistant is typing">
              <span className="w-2 h-2 bg-fc-text-muted rounded-full animate-pulse" />
              <span className="w-2 h-2 bg-fc-text-muted rounded-full animate-pulse delay-100" />
              <span className="w-2 h-2 bg-fc-text-muted rounded-full animate-pulse delay-200" />
            </div>
          </div>
        )}
        {guardrailError && (
          <div role="alert" className="rounded-xl p-3 bg-fc-danger/10 text-fc-danger-text text-sm">
            {guardrailError}
          </div>
        )}
        {preview && (
          <div className="rounded-xl border border-fc-neutral-200 p-4 bg-white">
            <p className="text-sm font-medium mb-2 text-fc-text-primary">{preview.summary}</p>
            <ul className="space-y-1 text-sm">
              {preview.added.map((a) => (
                <li key={a} className="bg-fc-success/10 text-fc-success-text px-2 py-1 rounded">
                  <ins className="no-underline">+ {a}</ins>
                </li>
              ))}
              {preview.removed.map((r) => (
                <li key={r} className="bg-fc-danger/10 text-fc-danger-text px-2 py-1 rounded">
                  <del className="no-underline">− {r}</del>
                </li>
              ))}
            </ul>
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={onApprove}
                className="flex-1 bg-fc-cobalt-600 text-white rounded-lg py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fc-cobalt-500"
              >
                Looks good
              </button>
              <button
                type="button"
                onClick={onReject}
                className="flex-1 border border-fc-neutral-300 rounded-lg py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fc-cobalt-500"
              >
                Revise
              </button>
            </div>
          </div>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const trimmed = text.trim()
          if (trimmed) {
            onSend(trimmed)
            setText('')
          }
        }}
        className="p-4 border-t border-fc-neutral-200 bg-white"
      >
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ask to update your site…"
            className="flex-1 rounded-lg border border-fc-neutral-300 px-3 py-2 text-sm text-fc-text-primary placeholder:text-fc-text-muted focus-visible:outline-none focus-visible:border-fc-cobalt-500 focus-visible:ring-4 focus-visible:ring-fc-cobalt-500/20"
            aria-label="Assistant request"
          />
          <button
            type="submit"
            className="bg-fc-cobalt-600 text-white rounded-lg px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fc-cobalt-500"
          >
            Send
          </button>
        </div>
      </form>
    </section>
  )
}
