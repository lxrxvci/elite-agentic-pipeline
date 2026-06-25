import { create } from 'zustand'

function getInitialToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem('__fc_clerk_token')
  } catch {
    return null
  }
}

interface AuthState {
  isAuthenticated: boolean | null
  isLoading: boolean
  token: string | null
  setAuthenticated: (value: boolean) => void
  setLoading: (value: boolean) => void
  setToken: (token: string | null) => void
  logout: () => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: null,
  isLoading: true,
  token: getInitialToken(),
  setAuthenticated: (value) => set({ isAuthenticated: value, isLoading: false }),
  setLoading: (value) => set({ isLoading: value }),
  setToken: (token) => set({ token }),
  logout: () => set({ isAuthenticated: false, isLoading: false, token: null }),
  clearAuth: () => set({ isAuthenticated: false, isLoading: false, token: null }),
}))
