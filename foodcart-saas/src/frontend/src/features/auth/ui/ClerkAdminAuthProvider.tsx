'use client'

import { useEffect } from 'react'
import { useAuth, useUser } from '@clerk/nextjs'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import { useAuthStore } from '../model/store'
import type { Tenant } from '@/shared/api/foodcart-types'

export function ClerkAdminAuthProvider({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded, getToken } = useAuth()
  const { user } = useUser()
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated)
  const setLoading = useAuthStore((s) => s.setLoading)
  const setToken = useAuthStore((s) => s.setToken)

  // Sync the short-lived Clerk JWT into memory only so apiClient can attach it
  // as a Bearer header. It is never persisted to localStorage.
  useEffect(() => {
    if (!isLoaded) return

    if (isSignedIn) {
      getToken()
        .then((token) => {
          setToken(token)
        })
        .catch(() => {
          setToken(null)
        })
    } else {
      setToken(null)
      setAuthenticated(false)
    }
  }, [isLoaded, isSignedIn, getToken, setToken, setAuthenticated])

  const { isSuccess, isError, isLoading } = useQuery<Tenant>({
    queryKey: ['tenants', 'me', user?.id],
    queryFn: () => apiClient('/tenants/me'),
    retry: false,
    staleTime: Infinity,
    enabled: isLoaded && isSignedIn,
  })

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return
    if (isSuccess) {
      setAuthenticated(true)
    } else if (isError) {
      setAuthenticated(false)
    } else if (!isLoading) {
      setLoading(false)
    }
  }, [isLoaded, isSignedIn, isSuccess, isError, isLoading, setAuthenticated, setLoading])

  return <>{children}</>
}
