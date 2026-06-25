# AIAssistantPanel

Chat-style side panel where owners request site edits and review structured change previews before approving.

## Usage

- Docked on the right side of the admin dashboard.
- Shows a message history, the latest `ChangePreview`, and Approve/Reject/Edit actions.

## Anatomy

```
┌──────────────────────────────┐
│ 🤖 AI Assistant        [×]   │
├──────────────────────────────┤
│ Owner: Add vegan section     │
│ Assistant: I'll add...       │
│                              │
│ ┌──────────────────────────┐ │
│ │  Diff preview            │ │
│ │  + Tofu Bowl     $12     │ │
│ │  - Lamb Curry            │ │
│ └──────────────────────────┘ │
│ [Looks good] [Revise]        │
├──────────────────────────────┤
│ [Type a request...] [Send]   │
└──────────────────────────────┘
```

## Tokens

| Element | Token | Default value |
|---|---|---|
| Width | `component.aiAssistantPanel.width` | `26rem` |
| Background | `component.aiAssistantPanel.background` | `surface-default` |
| Border | `component.aiAssistantPanel.border` | `border-default` |
| Shadow | `component.aiAssistantPanel.shadow` | `elevated` |
| Radius | `component.aiAssistantPanel.radius` | `panel` |
| Header background | `component.aiAssistantPanel.header.background` | `background-subtle` |
| Header border | `component.aiAssistantPanel.header.border` | `border-default` |
| User message bg | `component.aiAssistantPanel.messageUser.background` | `interactive-default` |
| User message text | `component.aiAssistantPanel.messageUser.text` | `text-inverse` |
| Assistant message bg | `component.aiAssistantPanel.messageAssistant.background` | `background-subtle` |
| Assistant message text | `component.aiAssistantPanel.messageAssistant.text` | `text-primary` |
| Diff added bg/text | `component.aiAssistantPanel.diffAdded.*` | `success-100` / `success-700` |
| Diff removed bg/text | `component.aiAssistantPanel.diffRemoved.*` | `danger-100` / `danger-700` |
| Input area bg | `component.aiAssistantPanel.inputArea.background` | `surface-default` |
| Input area border | `component.aiAssistantPanel.inputArea.border` | `border-default` |

## Behavior

- New owner messages append to the bottom.
- Assistant responses include a human-readable summary and a structured diff.
- Approve triggers a mutation; reject dismisses the preview.
- Loading state shows a pulsing ellipsis while awaiting the LLM.

## Accessibility

- Panel is a `<section>` with `aria-label="AI Website Assistant"`.
- Message list is a live region with `aria-live="polite"`.
- Approve/Reject buttons have clear labels and focus order follows visual order.
- Diff preview uses `ins`/`del` semantics or ARIA `role="addition"` / `role="deletion"`.
- Guardrail warnings are announced with `role="alert"`.

## Reference implementation

```tsx
interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface ChangePreview {
  summary: string
  added: string[]
  removed: string[]
}

export function AIAssistantPanel({
  messages,
  preview,
  onSend,
  onApprove,
  onReject,
}: {
  messages: Message[]
  preview?: ChangePreview
  onSend: (text: string) => void
  onApprove: () => void
  onReject: () => void
}) {
  const [text, setText] = useState('')
  return (
    <section aria-label="AI Website Assistant" className="w-full sm:w-[26rem] border-l border-neutral-200 bg-white flex flex-col h-full shadow-elevated">
      <header className="h-14 px-4 flex items-center justify-between border-b border-neutral-200 bg-neutral-50">
        <span className="font-semibold text-neutral-950">🤖 AI Assistant</span>
        <button aria-label="Close assistant" className="text-neutral-500 hover:text-neutral-950">×</button>
      </header>
      <div className="flex-1 overflow-y-auto p-4 space-y-4" aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={`${m.role === 'user' ? 'ml-8' : 'mr-8'}`}>
            <div className={`rounded-2xl px-4 py-3 text-sm ${m.role === 'user' ? 'bg-cobalt-600 text-white' : 'bg-neutral-100 text-neutral-950'}`}>
              {m.content}
            </div>
          </div>
        ))}
        {preview && (
          <div className="rounded-xl border border-neutral-200 p-4 bg-white">
            <p className="text-sm font-medium mb-2">{preview.summary}</p>
            <ul className="space-y-1 text-sm">
              {preview.added.map((a) => (
                <li key={a} className="bg-green-100 text-green-800 px-2 py-1 rounded">+ {a}</li>
              ))}
              {preview.removed.map((r) => (
                <li key={r} className="bg-red-100 text-red-800 px-2 py-1 rounded">− {r}</li>
              ))}
            </ul>
            <div className="flex gap-2 mt-3">
              <button onClick={onApprove} className="flex-1 bg-cobalt-600 text-white rounded-lg py-2 text-sm font-semibold">Looks good</button>
              <button onClick={onReject} className="flex-1 border border-neutral-300 rounded-lg py-2 text-sm font-semibold">Revise</button>
            </div>
          </div>
        )}
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onSend(text); setText('') } }}
        className="p-4 border-t border-neutral-200 bg-white"
      >
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ask to update your site…"
            className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-cobalt-500 focus:outline-none focus:ring-4 focus:ring-cobalt-500/20"
          />
          <button type="submit" className="bg-cobalt-600 text-white rounded-lg px-4 py-2 text-sm font-semibold">Send</button>
        </div>
      </form>
    </section>
  )
}
```

## Motion

- Messages slide in from the appropriate side (`translateX`) over `200ms`.
- Diff preview fades in after assistant response.
- Loading dots use `animate-pulse` with reduced-motion fallback.
