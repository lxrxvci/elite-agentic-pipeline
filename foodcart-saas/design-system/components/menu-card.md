# MenuCard

## Purpose

Displays a single menu item with image, name, description, price, and order-platform links.

## Anatomy

```
[MenuCard]
├── image
├── content
│   ├── title
│   ├── description
│   ├── price
│   └── order links
└── container
```

## Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | — | Dish name |
| `description` | `string` | — | Short description |
| `price` | `string` | — | Display price |
| `image` | `string` | — | Image URL |
| `orderLinks` | `{ platform: string; url: string }[]` | `[]` | Platform deep links |

## Tokens

- Background: `component.menu-card.background`
- Border: `component.menu-card.border`
- Radius: `component.menu-card.radius`
- Shadow: `component.menu-card.shadow`
- Padding: `component.menu-card.padding`
- Image radius: `component.menu-card.image-radius`

## Accessibility

- Dish image has meaningful `alt` text (dish name).
- Order links have visible labels and descriptive `aria-label`s when icon-only.
- Keyboard focus order follows visual order.
- Carousel container uses `role="region"` and `aria-roledescription="carousel"`.

## Usage examples

```tsx
<MenuCard
  name="Vietnamese Banh Mi"
  description="Pate, pickled carrots, jalapeño, cilantro"
  price="$12"
  image="/menu/banh-mi.jpg"
  orderLinks={[
    { platform: 'DoorDash', url: 'https://doordash.com/...' },
  ]}
/>
```
