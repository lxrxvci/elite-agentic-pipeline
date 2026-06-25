# HeroBlock

## Purpose

Primary brand introduction on generated restaurant sites: eyebrow, headline, subheadline, CTA row, and hero media.

## Anatomy

```
[HeroBlock]
├── eyebrow
├── headline
├── subheadline
├── CTA row
└── media (image / illustration)
```

## Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `eyebrow` | `string` | — | Short label above headline |
| `headline` | `string` | — | Main headline |
| `subheadline` | `string` | — | Supporting text |
| `primaryCta` | `{ label; href }` | — | Main action |
| `media` | `string` | — | Hero image URL |

## Tokens

- Headline font: `component.hero-block.headline-font`
- Eyebrow font: `component.hero-block.eyebrow-font`
- Text primary: `component.hero-block.text-primary`
- Text secondary: `component.hero-block.text-secondary`
- Padding Y: `component.hero-block.padding-y` / `component.hero-block.padding-y-desktop`

## Accessibility

- Headline is the page `<h1>`.
- Hero image uses `alt=""` if decorative, otherwise descriptive alt text.
- CTA row has a logical focus order.
- Animations respect `prefers-reduced-motion`.

## Usage examples

```tsx
<HeroBlock
  eyebrow="Portland, OR"
  headline="Banh Mi Fusion"
  subheadline="Fresh Vietnamese sandwiches served curbside."
  primaryCta={{ label: 'Order Now', href: '#order' }}
  media="/images/hero-cart.jpg"
/>
```
