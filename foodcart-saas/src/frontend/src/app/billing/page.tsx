'use client'

import { useEffect, useState } from 'react'

import { ProtectedRoute } from '@/features/auth/ui/ProtectedRoute'
import {
  useBillingPlans,
  useCancelSubscription,
  useCreateCheckout,
  useCreatePortal,
  useCurrentSubscription,
  useResumeSubscription,
} from '../../features/billing/api/useBilling'

function formatCurrency(value: string) {
  const num = Number.parseFloat(value)
  if (Number.isNaN(num)) return `$${value}`
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(num)
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function BillingPageContent() {
  const [interval, setInterval] = useState<'month' | 'year'>('month')
  const { data: plans, isLoading: plansLoading } = useBillingPlans()
  const { data: subscription, isLoading: subLoading } = useCurrentSubscription()
  const checkout = useCreateCheckout()
  const portal = useCreatePortal()
  const cancel = useCancelSubscription()
  const resume = useResumeSubscription()

  useEffect(() => {
    if (checkout.data?.checkout_url) {
      window.location.href = checkout.data.checkout_url
    }
  }, [checkout.data])

  useEffect(() => {
    if (portal.data?.url) {
      window.location.href = portal.data.url
    }
  }, [portal.data])

  const isPaid =
    subscription?.status === 'active' || subscription?.status === 'trialing'
  const isCanceled = subscription?.status === 'canceled' || Boolean(subscription?.canceled_at)
  const isLoading = plansLoading || subLoading

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="mb-6 text-3xl font-bold">Subscription & Billing</h1>

      {isLoading && <p>Loading billing details…</p>}

      {subscription && (
        <section className="mb-8 rounded-lg border p-6 shadow-sm">
          <h2 className="mb-4 text-xl font-semibold">Current Subscription</h2>
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-sm text-gray-500">Plan</dt>
              <dd className="font-medium capitalize">{subscription.plan}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Status</dt>
              <dd className="font-medium capitalize">{subscription.status ?? 'Trial'}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Billing Interval</dt>
              <dd className="font-medium capitalize">{subscription.billing_interval ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Current Period Ends</dt>
              <dd className="font-medium">{formatDate(subscription.current_period_end)}</dd>
            </div>
            {subscription.canceled_at && (
              <div className="col-span-2">
                <dt className="text-sm text-gray-500">Canceled On</dt>
                <dd className="font-medium">{formatDate(subscription.canceled_at)}</dd>
              </div>
            )}
          </dl>

          <div className="mt-6 flex flex-wrap gap-3">
            {isPaid && !isCanceled && (
              <>
                <button
                  onClick={() => portal.mutate()}
                  disabled={portal.isPending}
                  className="rounded-md bg-gray-900 px-4 py-2 text-white disabled:opacity-50"
                >
                  Manage Billing
                </button>
                <button
                  onClick={() => cancel.mutate()}
                  disabled={cancel.isPending}
                  className="rounded-md border px-4 py-2 text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {cancel.isPending ? 'Canceling…' : 'Cancel Subscription'}
                </button>
              </>
            )}
            {isPaid && isCanceled && (
              <button
                onClick={() => resume.mutate()}
                disabled={resume.isPending}
                className="rounded-md bg-green-600 px-4 py-2 text-white disabled:opacity-50"
              >
                {resume.isPending ? 'Resuming…' : 'Resume Subscription'}
              </button>
            )}
          </div>
        </section>
      )}

      {plans && (
        <section className="rounded-lg border p-6 shadow-sm">
          <h2 className="mb-4 text-xl font-semibold">Choose a Plan</h2>

          <div className="mb-6 flex gap-4">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="interval"
                value="month"
                checked={interval === 'month'}
                onChange={() => setInterval('month')}
              />
              Monthly
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="interval"
                value="year"
                checked={interval === 'year'}
                onChange={() => setInterval('year')}
              />
              Yearly <span className="text-sm text-green-600">(save ~33%)</span>
            </label>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <PlanCard
              plan={plans.monthly}
              selected={interval === 'month'}
              onSelect={() => setInterval('month')}
              cta={isPaid ? 'Switch to Monthly' : 'Subscribe Monthly'}
              onCheckout={() => checkout.mutate('month')}
              isPending={checkout.isPending && interval === 'month'}
            />
            <PlanCard
              plan={plans.yearly}
              selected={interval === 'year'}
              onSelect={() => setInterval('year')}
              cta={isPaid ? 'Switch to Yearly' : 'Subscribe Yearly'}
              onCheckout={() => checkout.mutate('year')}
              isPending={checkout.isPending && interval === 'year'}
            />
          </div>
        </section>
      )}
    </main>
  )
}

interface PlanCardProps {
  plan: { id: string; name: string; interval: 'month' | 'year'; price_usd: string }
  selected: boolean
  onSelect: () => void
  cta: string
  onCheckout: () => void
  isPending: boolean
}

function PlanCard({ plan, selected, onSelect, cta, onCheckout, isPending }: PlanCardProps) {
  return (
    <div
      className={`rounded-lg border p-5 ${
        selected ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-200'
      }`}
    >
      <h3 className="text-lg font-semibold">{plan.name}</h3>
      <p className="mt-2 text-3xl font-bold">{formatCurrency(plan.price_usd)}</p>
      <p className="text-sm text-gray-500">per {plan.interval}</p>
      <ul className="mt-4 space-y-2 text-sm">
        <li>✓ Unlimited published sites</li>
        <li>✓ Custom domain support</li>
        <li>✓ AI content assistant</li>
        <li>✓ Priority support</li>
      </ul>
      <button
        onClick={() => {
          onSelect()
          onCheckout()
        }}
        disabled={isPending}
        className="mt-5 w-full rounded-md bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
      >
        {isPending ? 'Redirecting…' : cta}
      </button>
    </div>
  )
}

export default function BillingPage() {
  return (
    <ProtectedRoute>
      <BillingPageContent />
    </ProtectedRoute>
  )
}
