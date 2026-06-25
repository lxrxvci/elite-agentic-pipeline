# OrderLinks

Prominent buttons linking to delivery/order platforms.

## Usage

- Platforms: DoorDash, UberEats, Grubhub, Postmates, plus a generic fallback.
- Rendered in the hero, a dedicated order section, and individual menu cards.

## Anatomy

```
[  DoorDash  ] [  UberEats  ] [  Grubhub  ]
```

## Tokens

| Element | Token | Default value |
|---|---|---|
| Gap | `component.orderLinks.gap` | `1rem` |
| Button style | `component.orderLinks.buttonStyle` | `component.button.primary` |
| Icon size | `component.orderLinks.iconSize` | `1.25rem` |
| DoorDash color | `component.orderLinks.platformColors.doordash` | `#ff3008` |
| UberEats color | `component.orderLinks.platformColors.ubereats` | `#000000` |
| Grubhub color | `component.orderLinks.platformColors.grubhub` | `#f63440` |
| Generic color | `component.orderLinks.platformColors.generic` | `interactive-default` |

## Behavior

- Each platform button shows the platform name and logo.
- Use `target="_blank"` and `rel="noopener noreferrer"`.
- If only one link is supplied, expand it to full width.

## Accessibility

- Buttons are `<a>` elements styled as buttons; use `role="button"` only if JS interception is required.
- Include the platform name in the accessible label: "Order on DoorDash".

## Reference implementation

```tsx
interface OrderLink {
  platform: 'doordash' | 'ubereats' | 'grubhub' | 'postmates' | string
  url: string
}

const platformColors: Record<string, string> = {
  doordash: 'bg-[#ff3008]',
  ubereats: 'bg-black',
  grubhub: 'bg-[#f63440]',
  postmates: 'bg-[#36454f]',
}

export function OrderLinks({ links }: { links: OrderLink[] }) {
  return (
    <div className="flex flex-col sm:flex-row gap-4">
      {links.map((link) => (
        <a
          key={link.platform}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className={`
            inline-flex items-center justify-center gap-2 rounded-full px-8 py-4
            text-sm font-bold uppercase tracking-wider text-white transition-all
            hover:-translate-y-0.5 hover:shadow-lg
            ${platformColors[link.platform] ?? 'bg-cobalt-600'}
          `}
        >
          <span aria-hidden className="text-lg">🛵</span>
          Order on {link.platform}
        </a>
      ))}
    </div>
  )
}
```

## Motion

- Same lift + shadow as `Button` primary.
- Icon bounces subtly on hover (`translateY(-1px)`).
