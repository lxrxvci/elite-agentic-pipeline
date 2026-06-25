import type { StoryBlockData } from '@/shared/api/foodcart-types'
import type { ThemeClasses } from '../lib/theme'

interface StorySectionProps {
  data: StoryBlockData
  theme: ThemeClasses
}

export function StorySection({ data, theme }: StorySectionProps) {
  return (
    <section className={`${theme.surfaceAlt} ${theme.textInverse} py-20 md:py-32`}>
      <div className="max-w-6xl mx-auto px-6 grid md:grid-cols-2 gap-12 items-center">
        {data.image_url && (
          <div className="order-2 md:order-1">
            <img
              src={data.image_url}
              alt=""
              className="w-full h-auto rounded-2xl shadow-card"
              loading="lazy"
            />
          </div>
        )}
        <div className="order-1 md:order-2 space-y-6">
          <h2 className="font-display text-display-md">{data.headline}</h2>
          <p className="text-lg leading-relaxed opacity-90 whitespace-pre-line">{data.body}</p>
          {data.quote && (
            <blockquote className={`text-xl italic border-l-4 pl-4 ${theme.accent} border-current`}>
              “{data.quote}”
            </blockquote>
          )}
        </div>
      </div>
    </section>
  )
}
