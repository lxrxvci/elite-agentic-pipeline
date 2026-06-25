# SiteSection

## Purpose

Responsive wrapper for generated restaurant site sections (Hero, About, Menu, Locations, Catering, Contact).

## Anatomy

```
[SiteSection]
├── section element with semantic heading
├── optional background theme
└── inner container (max-width, horizontal padding)
```

## Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `as` | `'section' \| 'header' \| 'footer'` | `'section'` | Landmark element |
| `theme` | `'default' \| 'alt' \| 'brand'` | `'default'` | Background treatment |
| `id` | `string` | — | Anchor target for nav |
| `children` | `ReactNode` | — | Section content |

## Tokens

- Padding Y: `component.site-section.padding-y` / `component.site-section.padding-y-desktop`
- Container max-width: `component.site-section.container-max-width`
- Container padding X: `component.site-section.container-padding-x`

## Accessibility

- Uses semantic `<section>` with a nested heading (`h1`–`h6`) that labels the section.
- `id` matches nav anchor links so skip-navigation works.
- Maintain logical heading order across sections.

## Usage examples

```tsx
<SiteSection id="menu" theme="alt">
  <h2>Menu</h2>
  <MenuCarousel items={menuItems} />
</SiteSection>
```
