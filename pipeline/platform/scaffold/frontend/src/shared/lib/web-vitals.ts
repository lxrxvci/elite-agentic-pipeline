import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals'

function reportVital(metric: Metric) {
  // Send to the backend vitals endpoint if available; otherwise log to console.
  const payload = {
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    id: metric.id,
    navigationType: metric.navigationType,
  }

  if (typeof window === 'undefined' || !process.env.NEXT_PUBLIC_API_URL) {
    // eslint-disable-next-line no-console
    console.log('[Web Vitals]', payload)
    return
  }

  const url = `${process.env.NEXT_PUBLIC_API_URL}/vitals`
  try {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      // Silently ignore network errors to avoid impacting user experience.
    })
  } catch {
    // Ignore errors from unsupported environments.
  }
}

export function initWebVitals() {
  onCLS(reportVital)
  onFCP(reportVital)
  onINP(reportVital)
  onLCP(reportVital)
  onTTFB(reportVital)
}
