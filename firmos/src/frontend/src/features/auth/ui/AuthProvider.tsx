'use client'

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import { useAuthStore } from '../model/store'

interface User {
  id: string
  email: string
  name: string
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated)
  const setLoading = useAuthStore((s) => s.setLoading)

  const { isSuccess, isError, isLoading } = useQuery<User>({
    queryKey: ['me'],
    queryFn: () => apiClient('/me'),
    retry: false,
    staleTime: Infinity,
  })

  useEffect(() => {
    if (isSuccess) {
      setAuthenticated(true)
    } else if (isError) {
      setAuthenticated(false)
    } else if (!isLoading) {
      setLoading(false)
    }
  }, [isSuccess, isError, isLoading, setAuthenticated, setLoading])

  return <>{children}</>
}
