# SocialLink

## Purpose

Icon-only links to social profiles (Instagram, Facebook, TikTok, Yelp, Google Business).

## Anatomy

```
[SocialLink]
├── icon
└── focus ring
```

## Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `platform` | `string` | — | Platform key |
| `href` | `string` | — | Profile URL |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Icon size |

## Tokens

- Color: `component.social-link.color`
- Color hover: `component.social-link.color-hover`
- Size: `component.social-link.size`

## Accessibility

- Each link has a unique, descriptive `aria-label` (e.g. "Follow Banh Mi Fusion on Instagram").
- Icon is decorative and hidden from assistive tech.
- External link uses `rel="noopener noreferrer"`.

## Usage examples

```tsx
<SocialLink platform="instagram" href="https://instagram.com/..." />
<SocialLink platform="yelp" href="https://yelp.com/..." />
```
