import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  send,
  trackUploadStep,
  trackOnboardingStep,
  trackError,
  telemetry,
} from './telemetry'

describe('telemetry', () => {
  const originalApiUrl = process.env.NEXT_PUBLIC_API_URL
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com/api/v1'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.NEXT_PUBLIC_API_URL = originalApiUrl
    vi.restoreAllMocks()
  })

  function lastFetchBody() {
    expect(fetchMock).toHaveBeenCalled()
    const [, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
    return JSON.parse((init as RequestInit).body as string)
  }

  it('send posts telemetry event to the API with keepalive', () => {
    send('test_event', { foo: 'bar' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/api/v1/telemetry',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: expect.stringContaining('"event":"test_event"'),
      }),
    )

    const body = lastFetchBody()
    expect(body.payload).toEqual({ foo: 'bar' })
    expect(typeof body.timestamp).toBe('string')
  })

  it('send falls back to console log when API URL is unavailable', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    delete process.env.NEXT_PUBLIC_API_URL

    send('offline_event', { a: 1 })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalledWith(
      '[Telemetry] offline_event',
      expect.objectContaining({ a: 1 }),
    )

    consoleSpy.mockRestore()
  })

  it('send falls back to console log when fetch is unavailable', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', undefined)

    send('no_fetch_event', { b: 2 })

    expect(consoleSpy).toHaveBeenCalledWith(
      '[Telemetry] no_fetch_event',
      expect.objectContaining({ b: 2 }),
    )

    consoleSpy.mockRestore()
  })

  it('trackUploadStep sends a prefixed event with duration and metadata', () => {
    trackUploadStep('compression_started', 42, { width: 100 })

    const body = lastFetchBody()
    expect(body.event).toBe('upload_step_compression_started')
    expect(body.payload).toEqual({ durationMs: 42, width: 100 })
  })

  it('trackUploadStep omits duration when not provided', () => {
    trackUploadStep('upload_failed', undefined, { message: 'oops' })

    const body = lastFetchBody()
    expect(body.event).toBe('upload_step_upload_failed')
    expect(body.payload.durationMs).toBeUndefined()
    expect(body.payload.message).toBe('oops')
  })

  it('trackOnboardingStep sends a prefixed event with metadata', () => {
    trackOnboardingStep('identity_completed', { source: 'wizard' })

    const body = lastFetchBody()
    expect(body.event).toBe('onboarding_step_identity_completed')
    expect(body.payload.source).toBe('wizard')
  })

  it('trackError sends error details and componentStack', () => {
    const err = new Error('boom')
    err.stack = 'stack trace'
    const errorInfo = { componentStack: '\n    in Component' }

    trackError(err, errorInfo)

    const body = lastFetchBody()
    expect(body.event).toBe('error')
    expect(body.payload.message).toBe('boom')
    expect(body.payload.name).toBe('Error')
    expect(body.payload.stack).toBe('stack trace')
    expect(body.payload.componentStack).toBe('\n    in Component')
  })

  it('telemetry object exposes the same helpers', () => {
    expect(telemetry.send).toBe(send)
    expect(telemetry.trackUploadStep).toBe(trackUploadStep)
    expect(telemetry.trackOnboardingStep).toBe(trackOnboardingStep)
    expect(telemetry.trackError).toBe(trackError)
  })
})
