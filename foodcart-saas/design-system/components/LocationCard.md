# LocationCard

Surface the business address, phone, live open/closed status, and hours. Used in generated sites and dashboard preview.

## Usage

- Single-location sites show one card centered; multi-location sites show a grid.
- Status badge recomputes every minute against the tenant timezone.

## Anatomy

```
┌─────────────────────────────────────┐
│ [OPEN NOW]                          │
│ Location Name                       │
│ 📍 123 Main St                      │
│    (Pod A)                          │
│ 📞 (503) 555-0100                   │
│ 🕒 Mon    10am – 9pm                │
│    Tue    10am – 9pm                │
│    ...                              │
│ Get Directions →                    │
└─────────────────────────────────────┘
```

## Tokens

| Element | Token | Default value |
|---|---|---|
| Background | `component.locationCard.background` | `surface-default` |
| Radius | `component.locationCard.radius` | `card` |
| Shadow | `component.locationCard.shadow` | `card` |
| Padding | `component.locationCard.padding` | `2rem` |
| Open badge bg | `component.locationCard.statusBadge.openBackground` | `success-500` |
| Open badge text | `component.locationCard.statusBadge.openText` | `white` |
| Closed badge bg | `component.locationCard.statusBadge.closedBackground` | `neutral-800` |
| Closed badge text | `component.locationCard.statusBadge.closedText` | `neutral-100` |
| Icon size | `component.locationCard.icon.size` | `1rem` |
| Icon color | `component.locationCard.icon.color` | `template.accent` |
| Name font | `component.locationCard.name` | `semantic.font.heading-lg` |
| Detail font | `component.locationCard.detail` | `semantic.font.body` |
| Link color | `component.locationCard.link.color` | `template.accent` |

## Behavior

- Status updates client-side without page reload.
- Closed today shows "Closed" and next open time helper text.
- Phone number is a `tel:` link.
- Address links to Google Maps.

## Accessibility

- Status badge uses `aria-live="polite"` so screen readers announce changes.
- Icons are decorative and hidden from AT (`aria-hidden="true"`).
- Phone and directions links have distinct accessible names.

## Reference implementation

```tsx
interface LocationCardProps {
  name: string
  address: string
  note?: string
  phone: string
  hours: { day: string; time: string }[]
  mapUrl: string
  isOpen: boolean
  statusText: string
}

export function LocationCard(props: LocationCardProps) {
  return (
    <article className="bg-white rounded-2xl shadow-card p-8">
      <span
        aria-live="polite"
        className={`inline-block rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${
          props.isOpen ? 'bg-green-500 text-white' : 'bg-neutral-800 text-neutral-100'
        }`}
      >
        {props.statusText}
      </span>
      <h3 className="font-display text-2xl font-bold mt-4 mb-2">{props.name}</h3>
      <div className="flex items-start gap-2 mb-1">
        <span aria-hidden className="text-amber-600 mt-1">📍</span>
        <div>
          <p className="text-neutral-700">{props.address}</p>
          {props.note && <p className="text-sm text-neutral-500">{props.note}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 mb-4">
        <span aria-hidden className="text-amber-600">📞</span>
        <a href={`tel:${props.phone.replace(/\D/g, '')}`} className="text-neutral-700 underline hover:text-amber-600">
          {props.phone}
        </a>
      </div>
      <div className="flex items-start gap-2 mb-4">
        <span aria-hidden className="text-amber-600 mt-1">🕒</span>
        <HoursGrid hours={props.hours} />
      </div>
      <a href={props.mapUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold uppercase tracking-wider text-amber-600 hover:underline">
        Get Directions →
      </a>
    </article>
  )
}
```

## Motion

- Badge color cross-fades when status flips.
- Card enters with a `translateY(2rem)` → `0` fade on scroll.
