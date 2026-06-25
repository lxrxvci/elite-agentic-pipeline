import type { CateringBlockData } from '@/shared/api/foodcart-types'
import type { ThemeClasses } from '../lib/theme'

interface CateringSectionProps {
  data: CateringBlockData
  theme: ThemeClasses
}

export function CateringSection({ data, theme }: CateringSectionProps) {
  return (
    <section className={`${theme.surfaceAlt} ${theme.textInverse} py-20 md:py-32`} id="catering">
      <div className="max-w-6xl mx-auto px-6 grid md:grid-cols-2 gap-12 items-center">
        <div className="space-y-6">
          <h2 className="font-display text-display-md">{data.headline}</h2>
          <p className="text-lg leading-relaxed opacity-90 whitespace-pre-line">{data.body}</p>
        </div>
        <form className="bg-white rounded-2xl shadow-card p-6 md:p-8 space-y-4" onSubmit={(e) => e.preventDefault()}>
          <div>
            <label htmlFor="catering-name" className="block text-sm font-semibold text-fc-text-primary">Name</label>
            <input id="catering-name" type="text" className="w-full mt-1 rounded-lg border border-fc-neutral-300 px-4 py-2" />
          </div>
          <div>
            <label htmlFor="catering-email" className="block text-sm font-semibold text-fc-text-primary">Email</label>
            <input id="catering-email" type="email" className="w-full mt-1 rounded-lg border border-fc-neutral-300 px-4 py-2" />
          </div>
          <div>
            <label htmlFor="catering-details" className="block text-sm font-semibold text-fc-text-primary">Event details</label>
            <textarea id="catering-details" rows={3} className="w-full mt-1 rounded-lg border border-fc-neutral-300 px-4 py-2" />
          </div>
          <button
            type="submit"
            className={`w-full rounded-full px-6 py-3 font-semibold transition-transform hover:-translate-y-0.5 ${theme.buttonPrimaryBg} ${theme.buttonPrimaryText}`}
          >
            {data.cta_text || 'Request catering'}
          </button>
        </form>
      </div>
    </section>
  )
}
