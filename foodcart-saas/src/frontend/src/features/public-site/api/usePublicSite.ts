import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import type { PublicSite } from '@/shared/api/foodcart-types'

export function usePublicSite(slug: string | undefined) {
  return useQuery<PublicSite>({
    queryKey: ['public', 'sites', slug],
    queryFn: () => apiClient(`/public/sites/${slug}`),
    enabled: !!slug,
    staleTime: 60 * 1000,
  })
}
