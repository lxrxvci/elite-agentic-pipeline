# Button

A tap-friendly, high-contrast action control used throughout onboarding, the admin dashboard, and generated sites.

## Usage

- **Primary** — main call-to-action (publish, save, approve).
- **Secondary** — supportive action (preview, back).
- **Outline** — low-emphasis action on a card or modal.
- **Ghost** — subtle action inside dense UI (icon-only rows, toolbars).
- **Danger** — destructive actions (revert, delete draft).

## Anatomy

```
┌─────────────────────────┐
│  [icon]  Label          │  ← pill-shaped container
└─────────────────────────┘
```

1. **Container** — rounded-full pill shape; supports focus ring.
2. **Icon** (optional) — leading icon only in generated-site CTAs.
3. **Label** — uppercase label token (`semantic.font.label`).

## Tokens

| Element | Token | Default value |
|---|---|---|
| Border radius | `component.button.radius` | `semantic.radius.button` → `9999px` |
| Padding X | `component.button.padding-x` | `1.5rem` |
| Padding Y | `component.button.padding-y` | `0.75rem` |
| Font | `component.button.font` | `semantic.font.label` |
| Primary background | `component.button.primary.background` | `semantic.color.interactive-default` |
| Primary text | `component.button.primary.text` | `semantic.color.text-inverse` |
| Hover transform | `component.button.primary.hover.transform` | `translateY(-2px)` |
| Disabled background | `component.button.primary.disabled.background` | `neutral-200` |

## Variants

| Variant | Background | Text | Border | Use case |
|---|---|---|---|---|
| `primary` | `interactive-default` | inverse | none | Main CTA |
| `secondary` | `interactive-subtle` | `interactive-default` | none | Secondary admin action |
| `outline` | transparent | `text-primary` | `border-strong` | Low-emphasis |
| `ghost` | transparent | `text-secondary` | none | Toolbar / icon row |
| `danger` | `danger-500` | white | none | Destructive |

All variants share the same pill radius, focus ring, and disabled opacity.

## Accessibility

- **Keyboard**: fully focusable; `Space` and `Enter` activate.
- **Focus ring**: `2px` solid `semantic.color.focus-ring`, `2px` offset, visible on `:focus-visible` only.
- **Disabled**: `aria-disabled="true"`, `opacity-50`, `cursor-not-allowed`; remains focusable for screen-reader discovery (do not add `disabled` prop if it must stay in tab order).
- **Icon buttons**: require `aria-label` when label is hidden.
- **Color contrast**: primary text/background pair exceeds WCAG 2.1 AA (4.5:1).

## Reference implementation

```tsx
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
  children: React.ReactNode
}

export function Button({
  variant = 'primary',
  children,
  className = '',
  ...props
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 font-display text-xs font-semibold uppercase tracking-widest transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-cobalt-500 disabled:opacity-50 disabled:cursor-not-allowed'
  const variants = {
    primary:
      'bg-cobalt-600 text-white hover:-translate-y-0.5 hover:shadow-md active:bg-cobalt-800',
    secondary:
      'bg-cobalt-100 text-cobalt-900 hover:bg-cobalt-200',
    outline:
      'border-2 border-neutral-300 bg-transparent text-neutral-950 hover:bg-neutral-50',
    ghost:
      'bg-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950',
    danger:
      'bg-red-500 text-white hover:bg-red-700',
  }
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  )
}
```

## Motion

- Hover lift: `translateY(-2px)` over `200ms`.
- Active press: scale to `0.98` over `75ms`.
- Focus ring: fades in via `transition-shadow`.
