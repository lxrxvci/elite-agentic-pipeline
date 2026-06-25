import type { OrderLink } from '../api/foodcart-types'

const PLATFORM_LABELS: Record<OrderLink['platform'], string> = {
  doordash: 'DoorDash',
  ubereats: 'UberEats',
  grubhub: 'Grubhub',
  website: 'Order Online',
  phone: 'Call to Order',
}

const PLATFORM_COLORS: Record<OrderLink['platform'], string> = {
  doordash: 'bg-[#ff3008] text-white',
  ubereats: 'bg-black text-white',
  grubhub: 'bg-[#f63440] text-white',
  website: 'bg-fc-cobalt-600 text-white',
  phone: 'bg-fc-terracotta-500 text-white',
}

interface OrderLinksProps {
  links: OrderLink[]
}

export function OrderLinks({ links }: OrderLinksProps) {
  return (
    <ul className="flex flex-wrap gap-3" aria-label="Order links">
      {links.map((link) => (
        <li key={link.platform}>
          <a
            href={link.url}
            target="_blank"
            rel="noreferrer"
            className={`inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold transition-transform hover:-translate-y-0.5 ${PLATFORM_COLORS[link.platform]}`}
            aria-label={`Order on ${PLATFORM_LABELS[link.platform]}`}
          >
            {PLATFORM_LABELS[link.platform]}
          </a>
        </li>
      ))}
    </ul>
  )
}
