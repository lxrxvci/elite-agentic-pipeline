'use client'

import { useSyncExternalStore } from 'react'

/**
 * FirmOS theme system - light default, dark via `.dark` on <html>.
 * Explicit choices persist to localStorage under `firmos-theme`
 * ('light' | 'dark'); until the user chooses, we follow
 * prefers-color-scheme. The no-FOUC bootstrap lives as an inline
 * script in src/app/layout.tsx and mirrors `resolveTheme` below.
 */

export const THEME_STORAGE_KEY = 'firmos-theme'

export type ThemeChoice = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice !== 'system') return choice
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyToDocument(resolved: ResolvedTheme) {
  document.documentElement.classList.toggle('dark', resolved === 'dark')
}

const listeners = new Set<() => void>()
function emitChange() {
  listeners.forEach((listener) => listener())
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange)
  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  const onSystemChange = () => {
    // System flips only matter while the user has no explicit choice.
    if (!window.localStorage.getItem(THEME_STORAGE_KEY)) {
      applyToDocument(resolveTheme('system'))
      emitChange()
    }
  }
  mql.addEventListener('change', onSystemChange)
  return () => {
    listeners.delete(onStoreChange)
    mql.removeEventListener('change', onSystemChange)
  }
}

function getSnapshot(): ResolvedTheme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function getServerSnapshot(): ResolvedTheme {
  return 'light'
}

export function setTheme(choice: ThemeChoice) {
  if (choice === 'system') {
    window.localStorage.removeItem(THEME_STORAGE_KEY)
  } else {
    window.localStorage.setItem(THEME_STORAGE_KEY, choice)
  }
  applyToDocument(resolveTheme(choice))
  emitChange()
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return {
    theme,
    setTheme,
    toggleTheme: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
  }
}
