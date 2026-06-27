export type TelemetryPayload = Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Send a telemetry event to the backend.
 *
 * When no API endpoint is available (e.g. during SSR without the public URL or
 * in environments without `fetch`), the event is logged to the console instead.
 */
export function send(eventName: string, payload: TelemetryPayload = {}) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL
  const timestamp = new Date().toISOString()

  if (!apiUrl || typeof fetch === 'undefined') {
    // eslint-disable-next-line no-console
    console.log(`[Telemetry] ${eventName}`, { ...payload, timestamp })
    return
  }

  const url = `${apiUrl}/telemetry`
  const body = JSON.stringify({ event: eventName, payload, timestamp })

  try {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      // Silently ignore network errors to avoid impacting user experience.
    })
  } catch {
    // Ignore errors from unsupported environments.
  }
}

/** Track an action within the photo upload onboarding step. */
export function trackUploadStep(
  action: string,
  durationMs?: number,
  metadata?: TelemetryPayload
) {
  const payload: TelemetryPayload = { ...(metadata ?? {}) }
  if (typeof durationMs === 'number') {
    payload.durationMs = durationMs
  }
  send(`upload_step_${action}`, payload)
}

/** Track an action within the onboarding flow. */
export function trackOnboardingStep(step: string, metadata?: TelemetryPayload) {
  send(`onboarding_step_${step}`, { ...(metadata ?? {}) })
}

/** Track a runtime error, optionally including React ErrorInfo. */
export function trackError(error: Error, errorInfo?: unknown) {
  const payload: TelemetryPayload = {
    message: error.message,
    name: error.name,
  }

  if (error.stack) {
    payload.stack = error.stack
  }

  if (isRecord(errorInfo) && typeof errorInfo.componentStack === 'string') {
    payload.componentStack = errorInfo.componentStack
  }

  send('error', payload)
}

/** Convenience namespace for consumers that prefer a single import. */
export const telemetry = {
  send,
  trackUploadStep,
  trackOnboardingStep,
  trackError,
}
