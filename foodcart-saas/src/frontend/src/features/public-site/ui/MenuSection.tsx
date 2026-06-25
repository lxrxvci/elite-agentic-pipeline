import type { MenuBlockData } from '@/shared/api/foodcart-types'
import type { ThemeClasses } from '../lib/theme'

interface MenuSectionProps {
  data: MenuBlockData
  theme: ThemeClasses
}

export function MenuSection({ data, theme }: MenuSectionProps) {
  return (
    <section className={`${theme.surface} ${theme.text} py-20 md:py-32`} id="menu">
      <div className="max-w-6xl mx-auto px-6">
        <h2 className="font-display text-display-md mb-12 text-center">Menu</h2>
        {data.featured && data.featured.length > 0 && (
          <div className="mb-16">
            <p className={`text-sm font-semibold uppercase tracking-widest mb-6 ${theme.accent}`}>Featured</p>
            <div className="flex gap-6 overflow-x-auto pb-4 snap-x">
              {data.featured.map((item) => (
                <div
                  key={item.name}
                  className="snap-start shrink-0 w-80 bg-white rounded-2xl shadow-card p-4"
                >
                  {item.image_url && (
                    <img src={item.image_url} alt="" className="w-full h-48 object-cover rounded-xl mb-4" loading="lazy" />
                  )}
                  <div className="flex justify-between items-start gap-2">
                    <h3 className="font-display text-xl font-bold text-fc-text-primary">{item.name}</h3>
                    <span className={`font-semibold ${theme.accent}`}>{item.price}</span>
                  </div>
                  {item.description && <p className="text-sm text-fc-text-secondary mt-1">{item.description}</p>}
                  {item.tags && item.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      {item.tags.map((tag) => (
                        <span key={tag} className="text-xs font-semibold px-2 py-1 rounded bg-fc-neutral-100 text-fc-text-secondary">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-12">
          {data.categories.map((category) => (
            <div key={category.title}>
              <h3 className={`text-sm font-semibold uppercase tracking-widest mb-6 ${theme.accent}`}>{category.title}</h3>
              <div className="grid md:grid-cols-2 gap-x-12 gap-y-6">
                {category.items.map((item) => (
                  <div key={item.name} className="flex justify-between gap-4 border-b border-current border-opacity-10 pb-4">
                    <div>
                      <h4 className="font-display text-lg font-bold">{item.name}</h4>
                      {item.description && <p className="text-sm opacity-80">{item.description}</p>}
                    </div>
                    <span className={`font-semibold shrink-0 ${theme.accent}`}>{item.price}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
