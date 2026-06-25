import { type TemplateId } from '../api/foodcart-types'

export interface TemplateOption {
  id: TemplateId
  name: string
  mood: string
  thumbnail: string
}

interface TemplateSelectorProps {
  templates: TemplateOption[]
  selectedId: TemplateId | undefined
  onSelect: (id: TemplateId) => void
  name?: string
}

export function TemplateSelector({
  templates,
  selectedId,
  onSelect,
  name = 'template',
}: TemplateSelectorProps) {
  return (
    <fieldset className="grid grid-cols-1 sm:grid-cols-3 gap-6" role="radiogroup" aria-label="Choose a template">
      <legend className="sr-only">Choose a template</legend>
      {templates.map((t) => {
        const selected = t.id === selectedId
        return (
          <label
            key={t.id}
            className={`
              cursor-pointer rounded-2xl border bg-white p-3 transition-all duration-200 block
              ${selected ? 'border-2 border-fc-cobalt-500 ring-4 ring-fc-cobalt-500/20' : 'border-fc-neutral-200 hover:shadow-card'}
            `}
          >
            <input
              type="radio"
              name={name}
              value={t.id}
              checked={selected}
              onChange={() => onSelect(t.id)}
              className="sr-only"
              aria-checked={selected}
            />
            <div className="aspect-[4/3] rounded-xl bg-fc-neutral-100 overflow-hidden">
              <img
                src={t.thumbnail}
                alt={`${t.name} template preview: ${t.mood}`}
                className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                loading="lazy"
              />
            </div>
            <div className="mt-3 flex items-start justify-between gap-2">
              <div>
                <p className="font-display text-lg font-bold text-fc-text-primary">{t.name}</p>
                <p className="text-sm text-fc-text-secondary">{t.mood}</p>
              </div>
              {selected && (
                <span className="shrink-0 bg-fc-cobalt-600 text-white text-xs font-semibold px-2 py-1 rounded-full">
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
