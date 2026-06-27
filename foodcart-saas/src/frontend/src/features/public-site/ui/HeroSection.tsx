import { sanitizeUrl } from '@/shared/lib/sanitizeUrl'
import type { HeroBlockData } from '@/shared/api/foodcart-types'
import type { ThemeClasses } from '../lib/theme'
import type { OpenStatus } from '../lib/hours'

interface HeroSectionProps {
  data: HeroBlockData
  theme: ThemeClasses
  openStatus?: OpenStatus
}

export function HeroSection({ data, theme, openStatus }: HeroSectionProps) {
  return (
    <section className={`relative ${theme.pageBg} ${theme.text} min-h-[80vh] flex items-center`}>
      <div className="w-full max-w-6xl mx-auto px-6 py-20 md:py-32 grid md:grid-cols-2 gap-12 items-center">
        <div className="space-y-6">
          {openStatus?.statusText && (
            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${openStatus.isOpen ? 'bg-fc-success text-white' : 'bg-fc-neutral-800 text-fc-neutral-100'}`}>
              <span className={`w-2 h-2 rounded-full ${openStatus.isOpen ? 'animate-pulse' : ''}`} />
              {openStatus.statusText}
            </span>
          )}
          <h1 className="font-display text-display-xl uppercase leading-none">
            {data.headline}
          </h1>
          {data.subheadline && <p className="text-lg md:text-xl opacity-90 max-w-md">{data.subheadline}</p>}
          {data.cta_text && (
            <a
              href={sanitizeUrl(data.cta_url) || '#order'}
              className={`inline-flex items-center justify-center rounded-full px-8 py-4 text-sm font-semibold transition-transform hover:-translate-y-0.5 ${theme.buttonPrimaryBg} ${theme.buttonPrimaryText}`}
            >
              {data.cta_text}
            </a>
          )}
        </div>
        {data.image_url ? (
          <div className="relative hidden md:block">
            <img
              src={data.image_url}
              alt=""
              className="w-full h-auto rounded-2xl shadow-elevated animate-float"
              loading="eager"
            />
          </div>
        ) : (
          <div className="hidden md:flex items-center justify-center">
            <div className={`w-64 h-64 rounded-full opacity-30 ${theme.surfaceAlt}`} />
          </div>
        )}
      </div>
    </section>
  )
}
