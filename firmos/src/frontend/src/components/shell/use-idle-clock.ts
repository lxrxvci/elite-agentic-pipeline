'use client'

import * as React from 'react'

/**
 * Clock-C2 client-side idle detection (the original's flow, restored):
 *
 *  - IdleDetector API where available (Chromium). It needs a permission
 *    grant, and the grant needs a user gesture, so a ONE-TIME explainer
 *    dialog asks first (the answer is remembered in localStorage - accepted
 *    starts the detector directly next time, declined never nags again).
 *  - Where unavailable or declined (Firefox, Safari, denied permission): an
 *    in-tab fallback watches input events (pointer/keys/wheel/touch, focus,
 *    visibility-return) and flips idle when they stop for the threshold.
 *
 * The hook only reports `idle` / `idleSince`; the widget owns what happens
 * next (countdown modal, forgiveness dialog, heartbeat pausing). Detection
 * runs only while `enabled` (the widget passes "clocked in").
 *
 * IdleDetector fires its change event when the user has been idle for the
 * threshold, so `idleSince` backdates by the threshold; the fallback knows
 * the last input instant exactly. Either way the widget's authoritative
 * baseline is the server's last_activity_at it last polled - the hook's
 * idleSince is the stand-in when that poll never carried one.
 */

const EXPLAINER_KEY = 'firmos.idle-explainer-v1'

type ExplainerAnswer = 'accepted' | 'declined'

interface IdleDetectorLike {
  userState: 'active' | 'idle' | null
  addEventListener(type: 'change', listener: () => void): void
  removeEventListener(type: 'change', listener: () => void): void
  start(options: { threshold: number; signal: AbortSignal }): Promise<void>
}

interface IdleDetectorCtor {
  new (): IdleDetectorLike
  requestPermission(): Promise<'granted' | 'denied'>
}

function idleDetectorCtor(): IdleDetectorCtor | null {
  if (typeof window === 'undefined') return null
  return (window as unknown as { IdleDetector?: IdleDetectorCtor }).IdleDetector ?? null
}

function savedExplainerAnswer(): ExplainerAnswer | null {
  try {
    const value = window.localStorage.getItem(EXPLAINER_KEY)
    return value === 'accepted' || value === 'declined' ? value : null
  } catch {
    return null
  }
}

function saveExplainerAnswer(answer: ExplainerAnswer): void {
  try {
    window.localStorage.setItem(EXPLAINER_KEY, answer)
  } catch {
    // Private mode: the explainer simply shows again next session.
  }
}

export interface UseIdleClockOptions {
  /** Detect only while clocked in (the widget's gate). */
  enabled: boolean
  /** The user's idle_timeout_minutes, in ms. */
  thresholdMs: number
}

export interface IdleClockState {
  /** True while the user is idle past the threshold. */
  idle: boolean
  /** epoch ms when the current idle stretch began (null while active). */
  idleSince: number | null
  /** The browser has the IdleDetector API. */
  detectorAvailable: boolean
  /** The one-time permission explainer is showing. */
  explainerOpen: boolean
  /** Explainer "Enable": request the permission (runs in the click gesture). */
  acceptExplainer: () => void
  /** Explainer "Not now": in-tab fallback, and don't ask again. */
  declineExplainer: () => void
}

const FALLBACK_INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

export function useIdleClock({ enabled, thresholdMs }: UseIdleClockOptions): IdleClockState {
  const [idle, setIdle] = React.useState(false)
  const [idleSince, setIdleSince] = React.useState<number | null>(null)
  const [explainerOpen, setExplainerOpen] = React.useState(false)
  const [detectorAvailable] = React.useState(() => idleDetectorCtor() != null)

  // What the explainer's answer turned into: 'detector' once granted, so a
  // later render doesn't reopen the explainer behind the detector's back.
  const [mode, setMode] = React.useState<'unknown' | 'detector' | 'fallback'>('unknown')

  const goIdle = React.useCallback((since: number) => {
    setIdle(true)
    setIdleSince(since)
  }, [])
  const goActive = React.useCallback(() => {
    setIdle(false)
    setIdleSince(null)
  }, [])

  // ── IdleDetector path (Chromium): permission via the one-time explainer ──
  React.useEffect(() => {
    if (!enabled) return
    const Ctor = idleDetectorCtor()
    if (!Ctor) return
    const answer = savedExplainerAnswer()
    if (answer === 'declined') return // the fallback effect below owns detection
    if (answer == null) {
      // First run: explain before asking (the request needs a click anyway).
      setExplainerOpen(true)
      return
    }
    // answer === 'accepted': a previous session granted - start directly.
    setMode('detector')
  }, [enabled])

  const acceptExplainer = React.useCallback(() => {
    const Ctor = idleDetectorCtor()
    setExplainerOpen(false)
    if (!Ctor) return
    void Ctor.requestPermission()
      .then((result) => {
        if (result === 'granted') {
          saveExplainerAnswer('accepted')
          setMode('detector')
        } else {
          saveExplainerAnswer('declined')
          setMode('fallback')
        }
      })
      .catch(() => setMode('fallback'))
  }, [])

  const declineExplainer = React.useCallback(() => {
    saveExplainerAnswer('declined')
    setExplainerOpen(false)
    setMode('fallback')
  }, [])

  // Run the detector itself once granted.
  React.useEffect(() => {
    if (!enabled || mode !== 'detector') return
    const Ctor = idleDetectorCtor()
    if (!Ctor) return
    const detector = new Ctor()
    const controller = new AbortController()
    // The API's floor is 60s; the fallback handles sub-minute thresholds.
    const detectorThreshold = Math.max(60_000, thresholdMs)
    const onChange = () => {
      if (detector.userState === 'idle') {
        goIdle(Date.now() - detectorThreshold)
      } else {
        goActive()
      }
    }
    detector.addEventListener('change', onChange)
    detector.start({ threshold: detectorThreshold, signal: controller.signal }).catch(() => {
      // Threshold below the API's 60s floor or a revoked grant: fall back.
      setMode('fallback')
    })
    return () => {
      detector.removeEventListener('change', onChange)
      controller.abort()
    }
  }, [enabled, mode, thresholdMs, goIdle, goActive])

  // ── Fallback path: in-tab input watching (Firefox/Safari/declined) ──────
  React.useEffect(() => {
    const Ctor = idleDetectorCtor()
    const useFallback = mode === 'fallback' || (mode === 'unknown' && (!Ctor || savedExplainerAnswer() === 'declined'))
    if (!enabled || !useFallback) return

    let lastInput = Date.now()
    const markInput = () => {
      lastInput = Date.now()
      goActive()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') markInput()
    }
    for (const type of FALLBACK_INPUT_EVENTS) {
      window.addEventListener(type, markInput, { passive: true })
    }
    // mousemove is high-frequency: record without the active-flip cost when
    // it lands inside an already-active stretch.
    let lastMoveMark = 0
    const onMouseMove = () => {
      const now = Date.now()
      if (now - lastMoveMark < 2_000) return
      lastMoveMark = now
      markInput()
    }
    window.addEventListener('mousemove', onMouseMove, { passive: true })
    window.addEventListener('focus', markInput)
    document.addEventListener('visibilitychange', onVisibility)

    const checkMs = Math.min(5_000, Math.max(50, Math.floor(thresholdMs / 4)))
    const check = setInterval(() => {
      if (Date.now() - lastInput >= thresholdMs) goIdle(lastInput)
    }, checkMs)

    return () => {
      for (const type of FALLBACK_INPUT_EVENTS) {
        window.removeEventListener(type, markInput)
      }
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('focus', markInput)
      document.removeEventListener('visibilitychange', onVisibility)
      clearInterval(check)
    }
  }, [enabled, mode, thresholdMs, goIdle, goActive])

  // Disabled (clocked out): stand down so a stale idle never leaks into the
  // next session.
  React.useEffect(() => {
    if (!enabled) {
      goActive()
      setExplainerOpen(false)
    }
  }, [enabled, goActive])

  return { idle, idleSince, detectorAvailable, explainerOpen, acceptExplainer, declineExplainer }
}
