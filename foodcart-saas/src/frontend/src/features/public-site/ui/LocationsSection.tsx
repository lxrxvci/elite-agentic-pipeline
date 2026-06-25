import type { LocationsBlockData } from '@/shared/api/foodcart-types'
import type { ThemeClasses } from '../lib/theme'
import { LocationCard } from '@/shared/ui/LocationCard'
import { computeOpenStatus } from '../lib/hours'

interface LocationsSectionProps {
  data: LocationsBlockData
  theme: ThemeClasses
}

export function LocationsSection({ data, theme }: LocationsSectionProps) {
  return (
    <section className={`${theme.surfaceAlt} ${theme.textInverse} py-20 md:py-32`} id="locations">
      <div className="max-w-6xl mx-auto px-6">
        <h2 className="font-display text-display-md mb-12 text-center">Locations & Hours</h2>
        <div className="grid md:grid-cols-2 gap-8">
          {data.locations.map((location) => {
            const status = computeOpenStatus(location.hours, location.timezone)
            return <LocationCard key={location.name} location={location} {...status} />
          })}
        </div>
      </div>
    </section>
  )
}
