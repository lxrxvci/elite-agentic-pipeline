'use client'

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient, setClerkToken } from '@/shared/api/client'
import { useAuthStore } from '../model/store'
import type { Tenant } from '@/shared/api/foodcart-types'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated)
  const setLoading = useAuthStore((s) => s.setLoading)
  const token = useAuthStore((s) => s.token)

  useEffect(() => {
    setClerkToken(token)
  }, [token])

  const { isSuccess, isError, isLoading } = useQuery<Tenant>({
    queryKey: ['tenants', 'me'],
    queryFn: () => apiClient('/tenants/me'),
    retry: false,
    staleTime: Infinity,
    enabled: !!token,
  })

  useEffect(() => {
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
  }, [isSuccess, isError, isLoading, token, setAuthenticated, setLoading])

  return <>{children}</>
}
