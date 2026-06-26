import { describe, expect, it } from 'vitest'
import type { CSSProperties } from 'react'
import { buildTheme, getTheme } from './theme'
import type { PublicSite } from '@/shared/api/foodcart-types'

const BASE_SITE: PublicSite = {
  slug: 'tacos',
  template_id: 'custom',
  publish_state: 'published',
  brand_colors: {
    primary: '#2563eb',
    secondary: '#f5f5f5',
    background: '#ffffff',
  },
  blocks: [],
}

function varValue(style: CSSProperties, name: string): string | undefined {
  return (style as Record<string, string | undefined>)[name]
}

describe('buildTheme', () => {
  it('uses brand colors when present', () => {
    const { classes, style } = buildTheme(BASE_SITE)
    expect(classes.pageBg).toBe('bg-[var(--fc-brand-page-bg)]')
    expect(varValue(style, '--fc-brand-primary')).toBe('#2563eb')
    expect(varValue(style, '--fc-brand-background')).toBe('#ffffff')
  })

  it('falls back to legacy banhmi theme', () => {
    const { style } = buildTheme({ ...BASE_SITE, template_id: 'banhmi', brand_colors: undefined })
    expect(varValue(style, '--fc-brand-background')).toBe('#f5e100')
  })

  it('falls back to legacy real-indian theme', () => {
    const { style } = buildTheme({ ...BASE_SITE, template_id: 'real-indian', brand_colors: undefined })
    expect(varValue(style, '--fc-brand-background')).toBe('#1a1a3e')
  })

  it('falls back to legacy mis-abuelos theme', () => {
    const { style } = buildTheme({ ...BASE_SITE, template_id: 'mis-abuelos', brand_colors: undefined })
    expect(varValue(style, '--fc-brand-background')).toBe('#1e5caa')
  })
})

describe('getTheme', () => {
  it('returns legacy banhmi classes', () => {
    const theme = getTheme('banhmi')
    expect(theme.pageBg).toBe('bg-[var(--fc-brand-page-bg)]')
  })
})
