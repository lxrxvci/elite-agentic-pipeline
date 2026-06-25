import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import type { Tenant } from '@/shared/api/foodcart-types'

export function useTenant() {
  return useQuery<Tenant>({
    queryKey: ['tenants', 'me'],
    queryFn: () => apiClient('/tenants/me'),
    retry: false,
    staleTime: 5 * 60 * 1000,
  })
}
