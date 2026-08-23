'use client'

import { useEffect } from 'react'
import { initWebVitals } from '@/shared/lib/web-vitals'

export function WebVitalsInit() {
  useEffect(() => {
    initWebVitals()
  }, [])

  return null
}
