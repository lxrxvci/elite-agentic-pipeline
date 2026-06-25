# StatusBadge

## Purpose

Communicates a transient or computed state, especially live open/closed status on location cards and dashboard health indicators.

## Anatomy

```
[StatusBadge]
├── leading dot (aria-hidden)
├── label text
└── container
```

## Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `status` | `'open' \| 'closed' \| 'success' \| 'warning' \| 'danger'` | — | Visual state |
| `size` | `'sm' \| 'md'` | `'md'` | Scale |
| `icon` | `'none' \| 'leading'` | `'leading'` | Pulsing dot |
| `label` | `string` | — | Override default label |

## Tokens

- Open background: `component.status-badge.open.background`
- Open text: `component.status-badge.open.text`
- Closed background: `component.status-badge.closed.background`
- Closed text: `component.status-badge.closed.text`
- Radius: `component.status-badge.radius`
- Padding: `component.status-badge.padding-x`, `component.status-badge.padding-y`

## Accessibility

- The leading dot is purely decorative and marked `aria-hidden="true"`.
- Status is conveyed by text label, not color alone.
- Use live regions (`aria-live="polite"`) when the badge updates automatically, e.g. open/closed toggle.
- Pulsing dot animation respects `prefers-reduced-motion`.

## Usage examples

```tsx
<StatusBadge status="open" />
// Renders: Open (green dot)

<StatusBadge status="closed" />
// Renders: Closed (gray dot)

<StatusBadge status="warning" label="Closing soon" />
```

## Notes

- For live location status, refresh on visibility change (`visibilitychange`) rather than polling aggressively.
