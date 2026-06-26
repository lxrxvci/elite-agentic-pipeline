import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { apiClient } from '../../../shared/api/client'
import type {
  BillingPlans,
  CheckoutRequest,
  CheckoutResponse,
  PortalResponse,
  Subscription,
} from '../../../shared/api/foodcart-types'

const BILLING_QUERY_KEY = ['billing', 'current'] as const
const PLANS_QUERY_KEY = ['billing', 'plans'] as const

export function useBillingPlans() {
  return useQuery({
    queryKey: PLANS_QUERY_KEY,
    queryFn: () => apiClient<BillingPlans>('/billing/plans'),
  })
}

export function useCurrentSubscription() {
  return useQuery({
    queryKey: BILLING_QUERY_KEY,
    queryFn: () => apiClient<Subscription>('/billing/current'),
  })
}

export function useCreateCheckout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (interval: 'month' | 'year') =>
      apiClient<CheckoutResponse>('/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ interval } satisfies CheckoutRequest),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BILLING_QUERY_KEY })
    },
  })
}

export function useCreatePortal() {
  return useMutation({
    mutationFn: () => apiClient<PortalResponse>('/billing/portal', { method: 'POST' }),
  })
}

export function useCancelSubscription() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiClient<Subscription>('/billing/cancel', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BILLING_QUERY_KEY })
    },
  })
}

export function useResumeSubscription() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiClient<Subscription>('/billing/resume', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BILLING_QUERY_KEY })
    },
  })
}
