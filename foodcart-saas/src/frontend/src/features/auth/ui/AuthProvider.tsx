'use client'

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@clerk/nextjs'
import { apiClient, setClerkToken } from '@/shared/api/client'
import { useAuthStore } from '../model/store'
import type { Tenant } from '@/shared/api/foodcart-types'

function useIsInsideClerkProvider() {
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useAuth()
    return true
  } catch {
    return false
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // When the admin layout wraps routes in <ClerkProvider>, the admin auth
  // lifecycle is handled by ClerkAdminAuthProvider. This provider continues
  // to manage legacy Elite-app authentication for routes outside Clerk.
  const isClerk = useIsInsideClerkProvider()

  const setAuthenticated = useAuthStore((s) => s.setAuthenticated)
  const setLoading = useAuthStore((s) => s.setLoading)
  const token = useAuthStore((s) => s.token)

  useEffect(() => {
    if (isClerk) return
    setClerkToken(token)
  }, [token, isClerk])

  const { isSuccess, isError, isLoading } = useQuery<Tenant>({
    queryKey: ['tenants', 'me'],
    queryFn: () => apiClient('/tenants/me'),
    retry: false,
    staleTime: Infinity,
    enabled: !isClerk && !!token,
  })

  useEffect(() => {
    if (isClerk) return
    if (!token) {
      setAuthenticated(false)
      return
    }
    if (isSuccess) {
      setAuthenticated(true)
    } else if (isError) {
      setAuthenticated(false)
    } else if (!isLoading) {
      setLoading(false)
    }
  }, [isClerk, isSuccess, isError, isLoading, token, setAuthenticated, setLoading])

  return <>{children}</>
}
