import { create } from 'zustand'

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
  token: null,
  setAuthenticated: (value) => set({ isAuthenticated: value, isLoading: false }),
  setLoading: (value) => set({ isLoading: value }),
  setToken: (token) => set({ token }),
  logout: () => set({ isAuthenticated: false, isLoading: false, token: null }),
  clearAuth: () => set({ isAuthenticated: false, isLoading: false, token: null }),
}))
