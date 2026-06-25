# Input

Text entry controls for forms across onboarding and the admin dashboard.

## Usage

- `text`, `email`, `tel`, `url`, `date`, `number`, `textarea`.
- Use `Label` and `Field` wrappers; never rely on placeholder alone.

## Anatomy

```
┌──────────────────────────────────┐
│ Label                            │
│ ┌──────────────────────────────┐ │
│ │ Placeholder text        icon │ │
│ └──────────────────────────────┘ │
│ Hint / error message             │
└──────────────────────────────────┘
```

## Tokens

| Element | Token | Default value |
|---|---|---|
| Background | `component.input.background` | `semantic.color.surface-default` |
| Border | `component.input.border` | `semantic.color.border-strong` |
| Border radius | `component.input.radius` | `semantic.radius.input` → `0.5rem` |
| Padding | `component.input.padding` | `0.75rem 1rem` |
| Text color | `component.input.text` | `semantic.color.text-primary` |
| Placeholder | `component.input.placeholder` | `semantic.color.text-muted` |
| Focus border | `component.input.focus.border` | `semantic.color.focus-ring` |
| Focus ring | `component.input.focus.ring` | `semantic.shadow.focus` |
| Error border | `component.input.error.border` | `global.color.danger-500` |
| Disabled background | `component.input.disabled.background` | `semantic.color.background-subtle` |

## States

| State | Border | Background | Notes |
|---|---|---|---|
| Rest | `border-strong` | white | — |
| Hover | `neutral-400` | white | Optional subtle darkening |
| Focus | `cobalt-500` | white | Ring + border |
| Error | `red-500` | white | Error text below |
| Disabled | `border-default` | `neutral-50` | `aria-disabled` |

## Accessibility

- Pair every input with a `<label>` using `htmlFor`/`id`.
- Use `aria-describedby` to link hint/error text.
- Error messages use `role="alert"` and `aria-live="polite"`.
- Input masks (phone) expose the raw value to assistive tech; do not trap cursor in masked segments.

## Reference implementation

```tsx
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: string
  error?: string
}

export function Input({ label, hint, error, className = '', ...props }: InputProps) {
  const id = props.id ?? label.toLowerCase().replace(/\s+/g, '-')
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium text-neutral-950">
        {label}
      </label>
      <input
        id={id}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ')}
        className={`
          rounded-lg border px-4 py-3 text-base text-neutral-950 placeholder:text-neutral-400
          transition-colors focus:border-cobalt-500 focus:outline-none focus:ring-4 focus:ring-cobalt-500/20
          disabled:bg-neutral-50 disabled:text-neutral-400
          ${error ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20' : 'border-neutral-300'}
        `}
        {...props}
      />
      {hint && !error && <p id={hintId} className="text-sm text-neutral-500">{hint}</p>}
      {error && <p id={errorId} className="text-sm text-red-700">{error}</p>}
    </div>
  )
}
```

## Motion

- Border color transition on focus/hover: `200ms`.
- Error message appears with a gentle fade/slide down.
