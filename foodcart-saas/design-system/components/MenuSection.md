# MenuSection

Displays featured dishes in a horizontal carousel plus an accordion-style full menu grouped by category. Used inside generated sites.

## Usage

- The menu block is theme-aware: colors resolve against the active template tokens (`semantic.template.*`).
- Supports dietary tags (V, VG, GF) rendered as small chips.

## Anatomy

```
SIGNATURE DISHES            <  >
THE LINEUP
┌────────────┐ ┌────────────┐ ┌────────────┐
│   image    │ │   image    │ │   image    │
│ name       │ │ name       │ │ name       │
│ desc       │ │ desc       │ │ desc       │
│ $price     │ │ $price     │ │ $price     │
│ UberEats   │ │ DoorDash   │ │            │
└────────────┘ └────────────┘ └────────────┘

EVERYTHING WE SERVE
Category — N items
• Item name          [V]    $12
  description
• Item name                 $10
```

## Tokens

| Element | Token | Default value |
|---|---|---|
| Category title font | `component.menuSection.categoryTitle.font` | `semantic.font.label` |
| Category title color | `component.menuSection.categoryTitle.color` | `semantic.template.primary` |
| Item name font | `component.menuSection.itemName.font` | `semantic.font.heading-md` |
| Item description font | `component.menuSection.itemDescription.font` | `semantic.font.body-sm` |
| Item price font/color | `component.menuSection.itemPrice.font/color` | `heading-md` / `template.accent` |
| Tag background | `component.menuSection.tag.background` | `template.secondary` |
| Tag text | `component.menuSection.tag.text` | `template.textInverse` |
| Carousel gap | `component.menuSection.carousel.gap` | `1.5rem` |
| Featured card width | `component.menuSection.carousel.cardWidth` | `21.25rem` |
| Featured card bg | `component.menuSection.featuredCard.background` | `surface-default` |
| Featured card radius | `component.menuSection.featuredCard.radius` | `card` |
| Featured card shadow | `component.menuSection.featuredCard.shadow` | `card` |
| Featured image height | `component.menuSection.featuredCard.imageHeight` | `12.5rem` |

## Behavior

- Carousel is swipeable / scroll-snapping on mobile and tablet.
- Left/right arrows appear on desktop (`md` breakpoint and up).
- Full menu categories stack vertically; items form a 1-column grid on mobile, 2-column on `md`+.

## Accessibility

- Carousel container has `role="region"` and `aria-roledescription="carousel"`.
- Each card is an article with `aria-labelledby` pointing to the item name.
- Scroll buttons have visible focus states and `aria-label="Previous dishes"` / `aria-label="Next dishes"`.
- Dietary tags have `title` or `aria-label` explaining the abbreviation (e.g., "Vegetarian").

## Reference implementation

```tsx
interface MenuItem {
  name: string
  description?: string
  price: string
  tag?: 'V' | 'VG' | 'GF'
}
interface MenuCategory {
  title: string
  items: MenuItem[]
}

export function MenuSection({ categories }: { categories: MenuCategory[] }) {
  return (
    <section id="menu" aria-label="Menu">
      {/* Carousel omitted for brevity; reuse <Card> for featured items. */}
      <div className="mt-16 space-y-8">
        {categories.map((cat) => (
          <div key={cat.title}>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-amber-600 mb-3">
              {cat.title} — {cat.items.length} items
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {cat.items.map((item) => (
                <div key={item.name} className="rounded-lg bg-white/10 p-4 flex justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-display font-bold text-sm">{item.name}</span>
                      {item.tag && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500 text-neutral-950">
                          {item.tag}
                        </span>
                      )}
                    </div>
                    {item.description && <p className="text-sm text-white/70 mt-1">{item.description}</p>}
                  </div>
                  <span className="font-display font-bold text-sm whitespace-nowrap">{item.price}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
```

## Motion

- Carousel scroll uses native smooth scroll.
- Category headings fade/slide up when entering viewport.
- Hover on featured card lifts card and slightly zooms image (`scale-105`).
