import type { OrderLinksBlockData } from '@/shared/api/foodcart-types'
import type { ThemeClasses } from '../lib/theme'
import { OrderLinks } from '@/shared/ui/OrderLinks'

interface OrderSectionProps {
  data: OrderLinksBlockData
  theme: ThemeClasses
}

export function OrderSection({ data, theme }: OrderSectionProps) {
  return (
    <section className={`${theme.surface} ${theme.text} py-20 md:py-32`} id="order">
      <div className="max-w-3xl mx-auto px-6 text-center space-y-8">
        <h2 className="font-display text-display-md">Order Now</h2>
        <p className="text-lg opacity-90">Pick your favorite platform and we&apos;ll get your order started.</p>
        <div className="flex justify-center">
          <OrderLinks links={data.links} />
        </div>
      </div>
    </section>
  )
}
