import type { ContentBlock, PublicSite } from '@/shared/api/foodcart-types'
import { getTheme } from '../lib/theme'
import { computeOpenStatus } from '../lib/hours'
import { HeroSection } from './HeroSection'
import { StorySection } from './StorySection'
import { MenuSection } from './MenuSection'
import { LocationsSection } from './LocationsSection'
import { OrderSection } from './OrderSection'
import { CateringSection } from './CateringSection'
import { FooterSection } from './FooterSection'

interface PublicSitePageProps {
  site: PublicSite
}

export function PublicSitePage({ site }: PublicSitePageProps) {
  const theme = getTheme(site.template_id)
  const locationsBlock = site.blocks.find((b) => b.block_type === 'locations') as ContentBlock<{ locations: { hours: Record<string, string>; timezone: string }[] }> | undefined
  const firstLocation = locationsBlock?.data.locations[0]
  const openStatus = firstLocation ? computeOpenStatus(firstLocation.hours, firstLocation.timezone) : undefined

  return (
    <main className={`${theme.pageBg} min-h-screen`}>
      <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-white focus:text-fc-text-primary focus:px-4 focus:py-2">
        Skip to content
      </a>
      <div id="content">
        {site.blocks
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((block) => renderBlock(block, theme, openStatus))}
      </div>
    </main>
  )
}

function renderBlock(block: ContentBlock, theme: ReturnType<typeof getTheme>, openStatus?: ReturnType<typeof computeOpenStatus>) {
  switch (block.block_type) {
    case 'hero':
      return <HeroSection key={block.id} data={block.data as never} theme={theme} openStatus={openStatus} />
    case 'story':
      return <StorySection key={block.id} data={block.data as never} theme={theme} />
    case 'menu':
      return <MenuSection key={block.id} data={block.data as never} theme={theme} />
    case 'locations':
      return <LocationsSection key={block.id} data={block.data as never} theme={theme} />
    case 'order_links':
      return <OrderSection key={block.id} data={block.data as never} theme={theme} />
    case 'catering':
      return <CateringSection key={block.id} data={block.data as never} theme={theme} />
    case 'footer':
      return <FooterSection key={block.id} data={block.data as never} theme={theme} />
    default:
      return null
  }
}
