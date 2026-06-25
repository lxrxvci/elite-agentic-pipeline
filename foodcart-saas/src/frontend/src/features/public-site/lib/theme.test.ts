import { describe, expect, it } from 'vitest'
import { getTheme } from './theme'

describe('getTheme', () => {
  it('returns banhmi theme', () => {
    const theme = getTheme('banhmi')
    expect(theme.pageBg).toBe('bg-banhmi-yellow')
    expect(theme.text).toBe('text-banhmi-black')
  })

  it('returns real-indian theme', () => {
    const theme = getTheme('real-indian')
    expect(theme.pageBg).toBe('bg-real-navy')
    expect(theme.text).toBe('text-real-creamwhite')
  })

  it('returns mis-abuelos theme', () => {
    const theme = getTheme('mis-abuelos')
    expect(theme.pageBg).toBe('bg-misa-cobalt')
    expect(theme.text).toBe('text-white')
  })
})
