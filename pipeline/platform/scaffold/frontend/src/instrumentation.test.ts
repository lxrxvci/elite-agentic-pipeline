import { describe, expect, it, vi } from 'vitest'
import { register } from './instrumentation'

const registerOTel = vi.fn()

vi.mock('@vercel/otel', () => ({
  registerOTel: (opts: unknown) => registerOTel(opts),
}))

describe('instrumentation', () => {
  it('registers OTel with the configured service name', () => {
    process.env.NEXT_PUBLIC_UNLEASH_APP_NAME = 'test-app'
    register()
    expect(registerOTel).toHaveBeenCalledWith({ serviceName: 'test-app' })
  })

  it('falls back to the default service name', () => {
    delete process.env.NEXT_PUBLIC_UNLEASH_APP_NAME
    register()
    expect(registerOTel).toHaveBeenCalledWith({ serviceName: 'elite-frontend' })
  })
})
