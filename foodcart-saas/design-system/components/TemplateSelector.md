# TemplateSelector

Presents the three food-native templates as selectable cards with a live preview thumbnail and a short mood description.

## Usage

- Appears in onboarding step 4 and in the admin dashboard "Appearance" tab.
- Selecting a template updates the generated site theme immediately in the preview frame.

## Anatomy

```
┌─────────────────────────────────┐
│ ┌─────────────────────────────┐ │
│ │  Preview thumbnail          │ │
│ │  (aspect 4:3)               │ │
│ └─────────────────────────────┘ │
│ Template name                   │
│ Mood description                │
│ [Selected] badge (if chosen)    │
└─────────────────────────────────┘
```

## Tokens

| Element | Token | Default value |
|---|---|---|
| Card aspect ratio | `component.templateSelector.card.aspectRatio` | `4 / 3` |
| Card radius | `component.templateSelector.card.radius` | `semantic.radius.card` |
| Card border | `component.templateSelector.card.border` | `semantic.color.border-default` |
| Card shadow | `component.templateSelector.card.shadow` | `semantic.shadow.card` |
| Selected border | `component.templateSelector.selected.border` | `cobalt-500` |
| Selected ring | `component.templateSelector.selected.ring` | `0 0 0 3px rgba(37,99,235,0.25)` |
| Selected badge bg | `component.templateSelector.selected.badgeBackground` | `interactive-default` |
| Preview bg | `component.templateSelector.preview.background` | `background-subtle` |
| Label font | `component.templateSelector.label` | `semantic.font.heading-md` |
| Description font | `component.templateSelector.description` | `semantic.font.body-sm` |

## Variants

| Variant | Purpose |
|---|---|
| `grid` | Three-column selector on desktop, one-column on mobile. |
| `list` | Compact stacked rows for dashboard settings. |

## Accessibility

- Each template card is a `<button>` or `<label>` with a hidden radio input.
- Use `role="radio"` or native `<input type="radio">` grouped with `role="radiogroup"` and `aria-label="Choose a template"`.
- The selected state is announced via `aria-checked="true"`.
- Preview thumbnails should have meaningful alt text describing the layout style.

## Reference implementation

```tsx
interface Template {
  id: string
  name: string
  mood: string
  thumbnail: string
}

interface TemplateSelectorProps {
  templates: Template[]
  selectedId: string
  onSelect: (id: string) => void
}

export function TemplateSelector({ templates, selectedId, onSelect }: TemplateSelectorProps) {
  return (
    <fieldset className="grid grid-cols-1 sm:grid-cols-3 gap-6">
      <legend className="sr-only">Choose a template</legend>
      {templates.map((t) => {
        const selected = t.id === selectedId
        return (
          <label
            key={t.id}
            className={`
              cursor-pointer rounded-2xl border bg-white p-3 transition-all duration-200
              ${selected ? 'border-2 border-cobalt-500 ring-4 ring-cobalt-500/20' : 'border-neutral-200 hover:shadow-card'}
            `}
          >
            <input
              type="radio"
              name="template"
              value={t.id}
              checked={selected}
              onChange={() => onSelect(t.id)}
              className="sr-only"
            />
            <div className="aspect-[4/3] rounded-xl bg-neutral-100 overflow-hidden">
              <img src={t.thumbnail} alt={`${t.name} template preview`} className="w-full h-full object-cover" />
            </div>
            <div className="mt-3 flex items-start justify-between">
              <div>
                <p className="font-display text-lg font-bold">{t.name}</p>
                <p className="text-sm text-neutral-500">{t.mood}</p>
              </div>
              {selected && (
                <span className="bg-cobalt-600 text-white text-xs font-semibold px-2 py-1 rounded-full">
                  Selected
                </span>
              )}
            </div>
          </label>
        )
      })}
    </fieldset>
  )
}
```

## Motion

- Hover: card shadow appears and preview scales `1.02` over `200ms`.
- Selection: border and ring animate in; badge fades in.
