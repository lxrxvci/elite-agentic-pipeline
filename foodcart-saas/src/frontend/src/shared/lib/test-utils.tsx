import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render as rtlRender, renderHook as rtlRenderHook, screen, waitFor } from '@testing-library/react'
import { ToastProvider } from '@/shared/ui'
import type { ReactNode } from 'react'

export { screen, waitFor }

export function render(ui: ReactNode) {
  const queryClient = createTestQueryClient()
  return rtlRender(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    ),
  })
}

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

export function renderHook<T>(callback: () => T) {
  const queryClient = createTestQueryClient()
  return rtlRenderHook(callback, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })
}
