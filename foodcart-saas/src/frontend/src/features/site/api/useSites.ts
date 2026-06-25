import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import type { Site } from '@/shared/api/foodcart-types'

export function useSites() {
  return useQuery<Site[]>({
    queryKey: ['sites'],
    queryFn: () => apiClient('/sites'),
    staleTime: 60 * 1000,
  })
}
