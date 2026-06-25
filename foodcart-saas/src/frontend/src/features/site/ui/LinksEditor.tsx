'use client'

import { useEffect, useState } from 'react'
import { Button, Card, Field, Input } from '@/shared/ui'
import { useSites } from '../api/useSites'
import { useBlocks } from '../api/useBlocks'
import { useUpdateBlock } from '../api/useUpdateBlock'
import type { FooterBlockData, OrderLinksBlockData, SocialLink, OrderLink, ContentBlockCreate } from '@/shared/api/foodcart-types'

const SOCIAL_PLATFORMS: SocialLink['platform'][] = ['google', 'yelp', 'instagram', 'facebook', 'tiktok', 'website']
const ORDER_PLATFORMS: OrderLink['platform'][] = ['doordash', 'ubereats', 'grubhub', 'website', 'phone']

export function LinksEditor() {
  const { data: sites } = useSites()
  const siteId = sites?.[0]?.id
  const { data: blocksData } = useBlocks(siteId)
  const footer = blocksData?.blocks.find((b) => b.block_type === 'footer')
  const orderBlock = blocksData?.blocks.find((b) => b.block_type === 'order_links')
  const updateFooter = useUpdateBlock(siteId, footer?.id)
  const updateOrder = useUpdateBlock(siteId, orderBlock?.id)

  const [socials, setSocials] = useState<SocialLink[]>([])
  const [orders, setOrders] = useState<OrderLink[]>([])

  useEffect(() => {
    if (footer) setSocials((footer.data as FooterBlockData).social_links)
    if (orderBlock) setOrders((orderBlock.data as OrderLinksBlockData).links)
  }, [footer, orderBlock])

  const updateSocial = (platform: SocialLink['platform'], url: string) => {
    setSocials((prev) => {
      const filtered = prev.filter((s) => s.platform !== platform)
      return url ? [...filtered, { platform, url }] : filtered
    })
  }

  const setOrderLink = (platform: OrderLink['platform'], url: string) => {
    setOrders((prev) => {
      const filtered = prev.filter((o) => o.platform !== platform)
      return url ? [...filtered, { platform, url }] : filtered
    })
  }

  const save = async () => {
    if (footer) {
      const body: ContentBlockCreate = {
        block_type: 'footer',
        schema_version: '1',
        data: { ...footer.data as FooterBlockData, social_links: socials },
        sort_order: footer.sort_order,
      }
      await updateFooter.mutateAsync(body)
    }
    if (orderBlock) {
      const body: ContentBlockCreate = {
        block_type: 'order_links',
        schema_version: '1',
        data: { links: orders },
        sort_order: orderBlock.sort_order,
      }
      await updateOrder.mutateAsync(body)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-bold">Links</h1>
      <Card>
        <h2 className="font-semibold text-lg mb-4">Social links</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {SOCIAL_PLATFORMS.map((platform) => (
            <Field key={platform} id={`social-${platform}`} label={platform.charAt(0).toUpperCase() + platform.slice(1)}>
              <Input
                id={`social-${platform}`}
                value={socials.find((s) => s.platform === platform)?.url || ''}
                onChange={(e) => updateSocial(platform, e.target.value)}
                placeholder="https://..."
              />
            </Field>
          ))}
        </div>
      </Card>
      <Card>
        <h2 className="font-semibold text-lg mb-4">Order links</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {ORDER_PLATFORMS.map((platform) => (
            <Field key={platform} id={`order-${platform}`} label={platform.charAt(0).toUpperCase() + platform.slice(1)}>
              <Input
                id={`order-${platform}`}
                value={orders.find((o) => o.platform === platform)?.url || ''}
                onChange={(e) => setOrderLink(platform, e.target.value)}
                placeholder={platform === 'phone' ? '(503) 555-0100' : 'https://...'}
              />
            </Field>
          ))}
        </div>
      </Card>
      <Button onClick={save} loading={updateFooter.isPending || updateOrder.isPending}>Save links</Button>
    </div>
  )
}
