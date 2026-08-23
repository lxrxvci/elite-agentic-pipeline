import { describe, expect, it, vi } from 'vitest'
import { initWebVitals } from './web-vitals'

const { reportVital } = vi.hoisted(() => ({ reportVital: vi.fn() }))

vi.mock('web-vitals', () => ({
  onCLS: (cb: (metric: unknown) => void) => reportVital('onCLS', cb),
  onFCP: (cb: (metric: unknown) => void) => reportVital('onFCP', cb),
  onINP: (cb: (metric: unknown) => void) => reportVital('onINP', cb),
  onLCP: (cb: (metric: unknown) => void) => reportVital('onLCP', cb),
  onTTFB: (cb: (metric: unknown) => void) => reportVital('onTTFB', cb),
}))

describe('web-vitals', () => {
  it('registers all core Web Vitals handlers', () => {
    initWebVitals()
    expect(reportVital).toHaveBeenCalledTimes(5)
    expect(reportVital).toHaveBeenCalledWith('onCLS', expect.any(Function))
  })

  it('logs metric payload when no API URL is configured', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const metric = {
      name: 'LCP',
      value: 1.2,
      rating: 'good',
      id: 'abc',
      navigationType: 'navigate',
    }

    initWebVitals()
    const calls = reportVital.mock.calls as [string, (m: unknown) => void][]
    const lcpCall = calls.find(([name]) => name === 'onLCP')
    expect(lcpCall).toBeDefined()
    lcpCall![1](metric)

    expect(consoleSpy).toHaveBeenCalledWith('[Web Vitals]', expect.objectContaining({ name: 'LCP' }))
    consoleSpy.mockRestore()
  })
})
