import { describe, expect, it, vi } from 'vitest'
import { render } from '@/shared/lib/test-utils'
import { initWebVitals } from '@/shared/lib/web-vitals'
import { WebVitalsInit } from './WebVitalsInit'

vi.mock('@/shared/lib/web-vitals', () => ({ initWebVitals: vi.fn() }))

describe('WebVitalsInit', () => {
  it('calls initWebVitals after mount', () => {
    render(<WebVitalsInit />)
    expect(initWebVitals).toHaveBeenCalled()
  })
})
