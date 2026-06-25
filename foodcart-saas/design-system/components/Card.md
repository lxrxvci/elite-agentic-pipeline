# Card

A contained surface for grouping related content: form sections, plan summaries, template previews, and dashboard widgets.

## Usage

- Wrap onboarding steps, dashboard panels, and AI diff summaries.
- Avoid nesting interactive cards inside other cards; use `aria-labelledby` to title the region.

## Anatomy

```
┌─────────────────────────────────────┐
│ Header (optional)                   │
├─────────────────────────────────────┤
│                                     │
│ Content slot                        │
│                                     │
├─────────────────────────────────────┤
│ Footer (optional)                   │
└─────────────────────────────────────┘
```

## Tokens

| Element | Token | Default value |
|---|---|---|
| Background | `component.card.background` | `semantic.color.surface-default` |
| Border | `component.card.border` | `semantic.color.border-default` |
| Border radius | `component.card.radius` | `semantic.radius.card` → `1rem` |
| Shadow | `component.card.shadow` | `global.shadow.card` |
| Padding | `component.card.padding` | `1.5rem` |
| Hover shadow | `component.card.hover.shadow` | `semantic.shadow.elevated` |
| Hover transform | `component.card.hover.transform` | `translateY(-2px)` |

## Variants

| Variant | Background | Border | Use case |
|---|---|---|---|
| `default` | `surface-default` | `border-default` | Standard panels |
| `flat` | `surface-default` | `border-default` | No shadow; dense lists |
| `selected` | `surface-default` | `cobalt-500` + ring | Selected template |
| `template` | `background-subtle` | none | Template preview card |

## Accessibility

- When the card is interactive (clickable whole card), use `<button>` or wrap with a link and ensure focus ring is visible.
- Provide a heading inside the card or an `aria-label` on the interactive region.
- Do not place interactive elements (buttons, links) inside an interactive card; if needed, lift actions to the footer.

## Reference implementation

```tsx
interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'flat' | 'selected' | 'template'
  children: React.ReactNode
}

export function Card({
  variant = 'default',
  children,
  className = '',
  ...props
}: CardProps) {
  const base = 'rounded-2xl overflow-hidden transition-all duration-200'
  const variants = {
    default:
      'bg-white border border-neutral-200 shadow-card hover:shadow-elevated hover:-translate-y-0.5',
    flat: 'bg-white border border-neutral-200',
    selected:
      'bg-white border-2 border-cobalt-500 ring-4 ring-cobalt-500/20 hover:shadow-elevated',
    template:
      'bg-neutral-50',
  }
  return (
    <div className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </div>
  )
}
```

## Motion

- Rest → hover: shadow deepens and card lifts `2px` over `200ms`.
- Selection: a `ring` fades in over `150ms`.
