import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import type { TenantOnboardingRequest, TenantOnboardingResponse } from '@/shared/api/foodcart-types'

export function useOnboard() {
  const queryClient = useQueryClient()
  return useMutation<TenantOnboardingResponse, Error, TenantOnboardingRequest>({
    mutationFn: (body) => apiClient('/tenants/onboard', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants', 'me'] })
      queryClient.invalidateQueries({ queryKey: ['sites'] })
    },
  })
}
