import { create } from 'zustand'

interface AuthState {
  isAuthenticated: boolean
  isLoading: boolean
  setAuthenticated: (value: boolean) => void
  setLoading: (value: boolean) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>()((set) => ({
  isAuthenticated: false,
  isLoading: true,
  setAuthenticated: (value) => set({ isAuthenticated: value, isLoading: false }),
  setLoading: (value) => set({ isLoading: value }),
  clearAuth: () => set({ isAuthenticated: false, isLoading: false }),
}))
