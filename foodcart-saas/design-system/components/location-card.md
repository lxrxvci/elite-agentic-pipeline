# LocationCard

## Purpose

Shows a single location with live open/closed status, address, phone, and hours grid.

## Anatomy

```
[LocationCard]
├── status badge
├── name
├── address
├── phone
└── hours grid
```

## Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | — | Location name |
| `address` | `string` | — | Street address |
| `phone` | `string` | — | Phone number |
| `hours` | `Hours[]` | — | Weekly hours |
| `timezone` | `string` | — | IANA timezone |

## Tokens

- Background: `component.location-card.background`
- Border: `component.location-card.border`
- Radius: `component.location-card.radius`
- Shadow: `component.location-card.shadow`
- Padding: `component.location-card.padding`

## Accessibility

- Status badge uses live region; updates when `isOpen` changes.
- Hours grid is a description list (`<dl>`) with day/label pairs.
- Phone number is a `tel:` link.
- Address is plain text unless directions link is provided.

## Usage examples

```tsx
<LocationCard
  name="Springwater Cart"
  address="123 SE Main St, Portland, OR"
  phone="(503) 555-0123"
  hours={locationHours}
  timezone="America/Los_Angeles"
/>
```
