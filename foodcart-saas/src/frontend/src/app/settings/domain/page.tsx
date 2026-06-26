'use client'

import { useEffect, useState } from 'react'

import {
  useDomainCheck,
  useDomainPurchase,
  useDomainSearch,
} from '@/features/domain/api/useDomainPurchase'
import {
  useConnectDomain,
  useDisconnectDomain,
  useDomainStatus,
} from '@/features/domain/api/useDomain'
import { useSites } from '@/features/site/api/useSites'
import { useCurrentSubscription } from '@/features/billing/api/useBilling'

export default function DomainSettingsPage() {
  const { data: sites } = useSites()
  const { data: subscription } = useCurrentSubscription()
  const [selectedSiteId, setSelectedSiteId] = useState('')
  const [externalDomain, setExternalDomain] = useState('')
  const [purchaseQuery, setPurchaseQuery] = useState('')
  const [selectedPurchaseDomain, setSelectedPurchaseDomain] = useState('')

  const selectedSite = sites?.find((site) => site.id === selectedSiteId)
  const connect = useConnectDomain(selectedSiteId)
  const disconnect = useDisconnectDomain(selectedSiteId)
  const status = useDomainStatus(selectedSiteId)
  const search = useDomainSearch(purchaseQuery)
  const check = useDomainCheck()
  const purchase = useDomainPurchase(selectedSiteId)

  const isPaid =
    subscription?.status === 'active' || subscription?.status === 'trialing'

  useEffect(() => {
    if (purchase.data?.checkout_url) {
      window.location.href = purchase.data.checkout_url
    }
  }, [purchase.data])

  const handleConnectExternal = (e: React.FormEvent) => {
    e.preventDefault()
    if (!externalDomain.trim() || !selectedSiteId) return
    connect.mutate({ domain: externalDomain.trim(), provider: 'external' })
  }

  const handleCheckDomain = (e: React.FormEvent) => {
    e.preventDefault()
    if (!purchaseQuery.trim()) return
    check.mutate([purchaseQuery.trim()])
    setSelectedPurchaseDomain('')
  }

  const handlePurchase = (domain: string) => {
    setSelectedPurchaseDomain(domain)
    purchase.mutate({ domain })
  }

  const availability = check.data?.domains[0] ?? search.data?.domains[0]

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-2 text-3xl font-bold">Custom Domain</h1>
      <p className="mb-6 text-gray-600">
        Connect your own domain or buy a new one.
      </p>

      {!isPaid && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">
          An active subscription is required to use custom domains.
        </div>
      )}

      <section className="mb-8 rounded-lg border p-6 shadow-sm">
        <label className="mb-2 block text-sm font-medium text-gray-700">
          Site
        </label>
        <select
          className="mb-6 block w-full rounded-md border-gray-300 p-2 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          value={selectedSiteId}
          onChange={(e) => {
            setSelectedSiteId(e.target.value)
            setExternalDomain('')
            setPurchaseQuery('')
            setSelectedPurchaseDomain('')
          }}
        >
          <option value="">Select a site…</option>
          {sites?.map((site) => (
            <option key={site.id} value={site.id}>
              {site.slug}
            </option>
          ))}
        </select>

        {selectedSite && (
          <>
            <div className="mb-8">
              <h2 className="mb-4 text-xl font-semibold">Connect your own domain</h2>
              <form onSubmit={handleConnectExternal} className="mb-4">
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Domain
                </label>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={externalDomain}
                    onChange={(e) => setExternalDomain(e.target.value)}
                    placeholder="example.com"
                    disabled={!isPaid || connect.isPending}
                    className="flex-1 rounded-md border-gray-300 p-2 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={!isPaid || connect.isPending || !externalDomain.trim()}
                    className="rounded-md bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
                  >
                    {connect.isPending ? 'Saving…' : 'Connect'}
                  </button>
                </div>
                <p className="mt-2 text-sm text-gray-500">
                  Point your domain&apos;s CNAME to{' '}
                  <code className="rounded bg-gray-100 px-1 py-0.5">
                    {process.env.NEXT_PUBLIC_PLATFORM_DOMAIN || 'your platform domain'}
                  </code>{' '}
                  before connecting.
                </p>
              </form>

              {selectedSite.custom_domain && (
                <div className="mb-4 rounded-md border p-4">
                  <p className="font-medium">
                    Current domain:{' '}
                    <span className="text-blue-600">
                      {selectedSite.custom_domain}
                    </span>
                  </p>
                  <button
                    onClick={() => disconnect.mutate()}
                    disabled={disconnect.isPending}
                    className="mt-3 rounded-md border px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    {disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                </div>
              )}

              {status.data && selectedSite.custom_domain && (
                <div className="rounded-md bg-gray-50 p-4">
                  <h3 className="mb-2 font-semibold">DNS Status</h3>
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <dt className="text-gray-500">Verified</dt>
                    <dd>{status.data.dns_verified ? '✓ Yes' : '✗ No'}</dd>
                    <dt className="text-gray-500">Message</dt>
                    <dd>{status.data.dns_message}</dd>
                  </dl>
                </div>
              )}

              {connect.error && (
                <p className="mt-4 text-sm text-red-600">
                  {connect.error.message || 'Failed to connect domain'}
                </p>
              )}
            </div>

            <div>
              <h2 className="mb-4 text-xl font-semibold">Buy a domain</h2>
              <form onSubmit={handleCheckDomain} className="mb-4">
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Search domain
                </label>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={purchaseQuery}
                    onChange={(e) => setPurchaseQuery(e.target.value)}
                    placeholder="example.test"
                    disabled={!isPaid || check.isPending || search.isPending}
                    className="flex-1 rounded-md border-gray-300 p-2 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={!isPaid || check.isPending || search.isPending || !purchaseQuery.trim()}
                    className="rounded-md bg-green-600 px-4 py-2 text-white disabled:opacity-50"
                  >
                    {check.isPending || search.isPending ? 'Checking…' : 'Check'}
                  </button>
                </div>
              </form>

              {(check.data ?? search.data) && (
                <div className="rounded-md bg-gray-50 p-4">
                  {availability ? (
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{availability.name}</p>
                        <p className="text-sm text-gray-500">
                          {availability.registrable
                            ? `${availability.currency} ${availability.registration_cost}/yr`
                            : `Unavailable${availability.reason ? `: ${availability.reason}` : ''}`}
                        </p>
                      </div>
                      {availability.registrable && (
                        <button
                          onClick={() => handlePurchase(availability.name)}
                          disabled={purchase.isPending || selectedPurchaseDomain === availability.name}
                          className="rounded-md bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
                        >
                          {purchase.isPending && selectedPurchaseDomain === availability.name
                            ? 'Starting checkout…'
                            : 'Buy'}
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">No results</p>
                  )}
                </div>
              )}

              {purchase.error && (
                <p className="mt-4 text-sm text-red-600">
                  {purchase.error.message || 'Failed to start domain purchase'}
                </p>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  )
}
