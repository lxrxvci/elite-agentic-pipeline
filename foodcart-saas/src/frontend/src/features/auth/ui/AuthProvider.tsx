'use client'

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import { useAuthStore } from '../model/store'
import { useInsideClerk } from './ClerkContext'
import type { Tenant } from '@/shared/api/foodcart-types'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // The admin layout wraps its routes in <ClerkProvider> and <InsideClerkProvider>,
  // so the Clerk admin auth lifecycle is handled by ClerkAdminAuthProvider.
  const isClerk = useInsideClerk()

  const setAuthenticated = useAuthStore((s) => s.setAuthenticated)
  const setLoading = useAuthStore((s) => s.setLoading)

  const { isSuccess, isError, isLoading } = useQuery<Tenant>({
    queryKey: ['tenants', 'me'],
    queryFn: () => apiClient('/tenants/me'),
    retry: false,
    staleTime: Infinity,
    enabled: !isClerk,
  })

  useEffect(() => {
    if (isClerk) return
    if (isSuccess) {
      setAuthenticated(true)
    } else if (isError) {
      setAuthenticated(false)
    } else if (!isLoading) {
      setLoading(false)
    }
  }, [isClerk, isSuccess, isError, isLoading, setAuthenticated, setLoading])

  return <>{children}</>
}
