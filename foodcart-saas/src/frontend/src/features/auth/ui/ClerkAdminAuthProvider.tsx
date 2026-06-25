'use client'

import { useEffect } from 'react'
import { useAuth, useUser } from '@clerk/nextjs'
import { useQuery } from '@tanstack/react-query'
import { apiClient, setClerkToken } from '@/shared/api/client'
import { useAuthStore } from '../model/store'
import type { Tenant } from '@/shared/api/foodcart-types'

export function ClerkAdminAuthProvider({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded, getToken } = useAuth()
  const { user } = useUser()
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated)
  const setLoading = useAuthStore((s) => s.setLoading)
  const setToken = useAuthStore((s) => s.setToken)

  // Sync Clerk session token into the legacy localStorage/token store so
  // apiClient can read it synchronously, and existing admin UI keeps working.
  useEffect(() => {
    if (!isLoaded) return

    if (isSignedIn) {
      getToken()
        .then((token) => {
          setToken(token)
          setClerkToken(token)
        })
        .catch(() => {
          setToken(null)
          setClerkToken(null)
        })
    } else {
      setToken(null)
      setClerkToken(null)
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
