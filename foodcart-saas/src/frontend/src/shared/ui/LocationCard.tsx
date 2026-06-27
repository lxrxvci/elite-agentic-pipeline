import { sanitizeUrl } from '../lib/sanitizeUrl'
import { HoursGrid } from './HoursGrid'
import type { Location } from '../api/foodcart-types'

export interface LocationCardProps {
  location: Location
  isOpen: boolean
  statusText: string
  nextStatusText?: string
}

export function LocationCard({ location, isOpen, statusText, nextStatusText }: LocationCardProps) {
  const phoneDigits = location.phone.replace(/\D/g, '')
  return (
    <article className="bg-white rounded-2xl shadow-card p-6 md:p-8">
      <span
        aria-live="polite"
        className={`inline-block rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${
          isOpen ? 'bg-fc-success text-white' : 'bg-fc-neutral-800 text-fc-neutral-100'
        }`}
      >
        {statusText}
      </span>
      {nextStatusText && (
        <p className="mt-2 text-sm text-fc-text-secondary">{nextStatusText}</p>
      )}
      <h3 className="font-display text-2xl font-bold mt-4 mb-2 text-fc-text-primary">{location.name}</h3>
      <div className="flex items-start gap-2 mb-1">
        <span aria-hidden="true" className="text-fc-terracotta-500 mt-1">📍</span>
        <div>
          <p className="text-fc-text-primary">{location.address}</p>
          {location.note && <p className="text-sm text-fc-text-secondary">{location.note}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 mb-4">
        <span aria-hidden="true" className="text-fc-terracotta-500">📞</span>
        <a href={`tel:${phoneDigits}`} className="text-fc-text-primary underline hover:text-fc-terracotta-500">
          {location.phone}
        </a>
      </div>
      <div className="flex items-start gap-2 mb-4">
        <span aria-hidden="true" className="text-fc-terracotta-500 mt-1">🕒</span>
        <HoursGrid hours={location.hours} />
      </div>
      {location.map_url && (
        <a
          href={sanitizeUrl(location.map_url)}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-semibold uppercase tracking-wider text-fc-terracotta-500 hover:underline"
        >
          Get Directions →
        </a>
      )}
    </article>
  )
}
