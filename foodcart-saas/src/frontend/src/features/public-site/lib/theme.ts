import type { TemplateId } from '@/shared/api/foodcart-types'

export interface ThemeClasses {
  pageBg: string
  text: string
  textInverse: string
  surface: string
  surfaceAlt: string
  accent: string
  primary: string
  secondary: string
  buttonPrimaryBg: string
  buttonPrimaryText: string
  buttonSecondaryBorder: string
  buttonSecondaryText: string
  diagonal?: string
}

export function getTheme(templateId: TemplateId): ThemeClasses {
  switch (templateId) {
    case 'banhmi':
      return {
        pageBg: 'bg-banhmi-yellow',
        text: 'text-banhmi-black',
        textInverse: 'text-white',
        surface: 'bg-banhmi-yellow',
        surfaceAlt: 'bg-banhmi-black',
        accent: 'text-banhmi-coral',
        primary: 'bg-banhmi-yellow',
        secondary: 'bg-banhmi-coral',
        buttonPrimaryBg: 'bg-banhmi-black',
        buttonPrimaryText: 'text-banhmi-yellow',
        buttonSecondaryBorder: 'border-banhmi-black',
        buttonSecondaryText: 'text-banhmi-black',
      }
    case 'real-indian':
      return {
        pageBg: 'bg-real-navy',
        text: 'text-real-creamwhite',
        textInverse: 'text-real-navy',
        surface: 'bg-real-navy',
        surfaceAlt: 'bg-real-cream',
        accent: 'text-real-gold',
        primary: 'bg-real-saffron',
        secondary: 'bg-real-magenta',
        buttonPrimaryBg: 'bg-real-saffron',
        buttonPrimaryText: 'text-real-creamwhite',
        buttonSecondaryBorder: 'border-real-creamwhite',
        buttonSecondaryText: 'text-real-creamwhite',
      }
    case 'mis-abuelos':
      return {
        pageBg: 'bg-misa-cobalt',
        text: 'text-white',
        textInverse: 'text-misa-cobalt',
        surface: 'bg-misa-cobalt',
        surfaceAlt: 'bg-misa-cream',
        accent: 'text-misa-gold',
        primary: 'bg-misa-gold',
        secondary: 'bg-misa-terracotta',
        buttonPrimaryBg: 'bg-misa-gold',
        buttonPrimaryText: 'text-misa-cobalt',
        buttonSecondaryBorder: 'border-white',
        buttonSecondaryText: 'text-white',
      }
    default:
      return getTheme('banhmi')
  }
}
