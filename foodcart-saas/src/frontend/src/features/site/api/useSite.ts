import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import type { Site } from '@/shared/api/foodcart-types'

export function useSite(siteId: string | undefined) {
  return useQuery<Site>({
    queryKey: ['sites', siteId],
    queryFn: () => apiClient(`/sites/${siteId}`),
    enabled: !!siteId,
    staleTime: 60 * 1000,
  })
}
