import type { FooterBlockData } from '@/shared/api/foodcart-types'
import type { ThemeClasses } from '../lib/theme'
import { SocialLinks } from '@/shared/ui/SocialLinks'

interface FooterSectionProps {
  data: FooterBlockData
  theme: ThemeClasses
}

export function FooterSection({ data, theme }: FooterSectionProps) {
  return (
    <footer className={`${theme.surface} ${theme.text} py-12`}>
      <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
        <SocialLinks links={data.social_links} inverse={theme.text === 'text-white'} />
        <p className="text-sm opacity-70">{data.copyright || '© Foodcart site'}</p>
      </div>
    </footer>
  )
}
