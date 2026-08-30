import type { CSSProperties } from 'react'

/**
 * Avatar identity hues (design mandate: color means state OR identity).
 * A deterministic hash of the person key (always `user:${id}` so the same
 * person reads the same hue on every surface) picks one of the 8 oklch
 * fg/bg pairs defined in globals.css. Every pair passes WCAG AA (4.5:1+)
 * for the initials text in both themes. The hue is identity only; status
 * never comes from the avatar.
 */

const AVATAR_HUE_COUNT = 8

export function avatarHue(key: string | number): number {
  const s = String(key)
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return (Math.abs(h) % AVATAR_HUE_COUNT) + 1
}

/** Inline style so the 8 pairs stay plain CSS vars (no generated utilities). */
export function avatarStyle(userId: string | number): CSSProperties {
  const n = avatarHue(`user:${userId}`)
  return {
    backgroundColor: `var(--avatar-${n}-bg)`,
    color: `var(--avatar-${n}-fg)`,
  }
}
