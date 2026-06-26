import type { CSSProperties } from 'react'
import type { BrandColors, PublicSite, Site, TemplateId } from '@/shared/api/foodcart-types'

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

interface ThemeResult {
  classes: ThemeClasses
  style: CSSProperties
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '')
  const bigint = parseInt(clean, 16)
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  }
}

function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  const [rs, gs, bs] = [r, g, b].map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
}

function contrastColor(hex: string): string {
  return luminance(hex) > 0.5 ? '#0a0a0a' : '#ffffff'
}

interface SemanticColors {
  primary: string
  secondary: string
  background: string
  accent: string
  surface: string
  surfaceAlt: string
}

function buildVariableTheme(colors: SemanticColors): ThemeResult {
  const text = contrastColor(colors.background)
  const textInverse = contrastColor(colors.surfaceAlt)
  const textOnPrimary = contrastColor(colors.primary)

  const style: CSSProperties = {
    '--fc-brand-primary': colors.primary,
    '--fc-brand-secondary': colors.secondary,
    '--fc-brand-background': colors.background,
    '--fc-brand-page-bg': colors.background,
    '--fc-brand-surface': colors.surface,
    '--fc-brand-surface-alt': colors.surfaceAlt,
    '--fc-brand-accent': colors.accent,
    '--fc-brand-text': text,
    '--fc-brand-text-inverse': textInverse,
    '--fc-brand-text-on-primary': textOnPrimary,
    '--fc-brand-button-secondary-border': text,
    '--fc-brand-button-secondary-text': text,
  } as CSSProperties

  const classes: ThemeClasses = {
    pageBg: 'bg-[var(--fc-brand-page-bg)]',
    text: 'text-[var(--fc-brand-text)]',
    textInverse: 'text-[var(--fc-brand-text-inverse)]',
    surface: 'bg-[var(--fc-brand-surface)]',
    surfaceAlt: 'bg-[var(--fc-brand-surface-alt)]',
    accent: 'text-[var(--fc-brand-accent)]',
    primary: 'bg-[var(--fc-brand-primary)]',
    secondary: 'bg-[var(--fc-brand-secondary)]',
    buttonPrimaryBg: 'bg-[var(--fc-brand-primary)]',
    buttonPrimaryText: 'text-[var(--fc-brand-text-on-primary)]',
    buttonSecondaryBorder: 'border-[var(--fc-brand-button-secondary-border)]',
    buttonSecondaryText: 'text-[var(--fc-brand-button-secondary-text)]',
  }

  return { classes, style }
}

function legacyTheme(templateId: Exclude<TemplateId, 'custom'>): ThemeResult {
  const themes: Record<Exclude<TemplateId, 'custom'>, SemanticColors> = {
    banhmi: {
      primary: '#0a0a0a',
      secondary: '#ff6b5b',
      background: '#f5e100',
      accent: '#ff6b5b',
      surface: '#f5e100',
      surfaceAlt: '#0a0a0a',
    },
    'real-indian': {
      primary: '#e86a33',
      secondary: '#fff8e1',
      background: '#1a1a3e',
      accent: '#d4a017',
      surface: '#1a1a3e',
      surfaceAlt: '#fff8e1',
    },
    'mis-abuelos': {
      primary: '#d4a017',
      secondary: '#c65d3b',
      background: '#1e5caa',
      accent: '#d4a017',
      surface: '#1e5caa',
      surfaceAlt: '#f9f5eb',
    },
  }
  return buildVariableTheme(themes[templateId])
}

function brandTheme(brandColors: BrandColors): ThemeResult {
  return buildVariableTheme({
    primary: brandColors.primary,
    secondary: brandColors.secondary,
    background: brandColors.background,
    accent: brandColors.primary,
    surface: brandColors.background,
    surfaceAlt: brandColors.secondary,
  })
}

export function buildTheme(site: Site | PublicSite): ThemeResult {
  if (site.brand_colors) {
    return brandTheme(site.brand_colors)
  }
  if (site.template_id !== 'custom') {
    return legacyTheme(site.template_id)
  }
  return brandTheme({
    primary: '#2563eb',
    secondary: '#f5f5f5',
    background: '#ffffff',
  })
}

// Deprecated: kept for callers that only have a legacy template id.
export function getTheme(templateId: TemplateId): ThemeClasses {
  if (templateId === 'custom') {
    return buildTheme({ template_id: 'custom', publish_state: 'draft', slug: '', blocks: [] }).classes
  }
  return legacyTheme(templateId).classes
}
