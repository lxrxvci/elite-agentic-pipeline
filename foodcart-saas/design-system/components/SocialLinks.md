# SocialLinks

Row of icon links to external social profiles and review platforms.

## Usage

- Supported platforms: Google Business Profile, Yelp, Instagram, Facebook, TikTok.
- Falls back to a generic link icon for unknown platforms.
- Used in generated site footer and admin "Links" panel.

## Anatomy

```
[Yelp] [Instagram] [Facebook] [TikTok] [Google]
```

## Tokens

| Element | Token | Default value |
|---|---|---|
| Gap | `component.socialLinks.gap` | `1rem` |
| Icon size | `component.socialLinks.iconSize` | `1.25rem` |
| Default color | `component.socialLinks.defaultColor` | `text-secondary` |
| Hover color | `component.socialLinks.hoverColor` | `text-primary` |
| Inverse color | `component.socialLinks.inverseColor` | `rgba(255,255,255,0.8)` |
| Inverse hover | `component.socialLinks.inverseHoverColor` | `white` |

## Behavior

- Icons open in a new tab with `rel="noopener noreferrer"`.
- Text labels are optional on mobile (icon-only).
- Inverse variant is used on dark hero/footer sections.

## Accessibility

- Each link has an `aria-label` naming the platform and destination (e.g., "Yelp page").
- The icon itself is `aria-hidden`.
- Focus ring is visible on each link.

## Reference implementation

```tsx
interface SocialLink {
  platform: 'google' | 'yelp' | 'instagram' | 'facebook' | 'tiktok' | string
  url: string
}

export function SocialLinks({
  links,
  inverse = false,
}: {
  links: SocialLink[]
  inverse?: boolean
}) {
  const color = inverse
    ? 'text-white/80 hover:text-white'
    : 'text-neutral-500 hover:text-neutral-950'
  return (
    <ul className="flex items-center gap-4">
      {links.map((link) => (
        <li key={link.platform}>
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${link.platform} page`}
            className={`block transition-colors focus-visible:ring-2 focus-visible:ring-cobalt-500 rounded ${color}`}
          >
            <span className="text-xl" aria-hidden>
              {link.platform[0].toUpperCase()}
            </span>
          </a>
        </li>
      ))}
    </ul>
  )
}
```

## Motion

- Hover color transition: `150ms`.
- Icon-only links scale to `1.1` on hover.
