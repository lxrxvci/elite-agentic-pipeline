import type { SocialLink } from '../api/foodcart-types'

const PLATFORM_LABELS: Record<SocialLink['platform'], string> = {
  google: 'Google Business Profile',
  yelp: 'Yelp',
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  website: 'Website',
}

interface SocialLinksProps {
  links: SocialLink[]
  inverse?: boolean
}

export function SocialLinks({ links, inverse = false }: SocialLinksProps) {
  return (
    <ul className="flex flex-wrap items-center gap-4" aria-label="Social links">
      {links.map((link) => (
        <li key={link.platform}>
          <a
            href={link.url}
            target="_blank"
            rel="noreferrer"
            aria-label={PLATFORM_LABELS[link.platform]}
            className={`text-sm font-medium underline underline-offset-2 ${
              inverse ? 'text-white/80 hover:text-white' : 'text-fc-text-secondary hover:text-fc-text-primary'
            }`}
          >
            {PLATFORM_LABELS[link.platform]}
          </a>
        </li>
      ))}
    </ul>
  )
}
