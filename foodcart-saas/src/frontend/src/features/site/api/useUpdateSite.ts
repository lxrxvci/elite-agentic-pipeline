import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import type { Site, SiteUpdate } from '@/shared/api/foodcart-types'

export function useUpdateSite(siteId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation<Site, Error, SiteUpdate>({
    mutationFn: (body) => apiClient(`/sites/${siteId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites', siteId] })
      queryClient.invalidateQueries({ queryKey: ['sites'] })
    },
  })
}
