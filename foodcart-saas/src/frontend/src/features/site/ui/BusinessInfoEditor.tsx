'use client'

import { useEffect, useState } from 'react'
import { Button, Card, Field, Input, Textarea } from '@/shared/ui'
import { useSites } from '../api/useSites'
import { useBlocks } from '../api/useBlocks'
import { useUpdateBlock } from '../api/useUpdateBlock'
import type { HeroBlockData, StoryBlockData, ContactBlockData, ContentBlockCreate } from '@/shared/api/foodcart-types'

export function BusinessInfoEditor() {
  const { data: sites } = useSites()
  const siteId = sites?.[0]?.id
  const { data: blocksData } = useBlocks(siteId)
  const blocks = blocksData?.blocks ?? []

  const hero = blocks.find((b) => b.block_type === 'hero')
  const story = blocks.find((b) => b.block_type === 'story')
  const contact = blocks.find((b) => b.block_type === 'contact')

  const updateHero = useUpdateBlock(siteId, hero?.id)
  const updateStory = useUpdateBlock(siteId, story?.id)
  const updateContact = useUpdateBlock(siteId, contact?.id)

  const [heroData, setHeroData] = useState<HeroBlockData>({ headline: '' })
  const [storyData, setStoryData] = useState<StoryBlockData>({ headline: '', body: '' })
  const [contactData, setContactData] = useState<ContactBlockData>({})

  useEffect(() => {
    if (hero) setHeroData(hero.data as HeroBlockData)
    if (story) setStoryData(story.data as StoryBlockData)
    if (contact) setContactData(contact.data as ContactBlockData)
  }, [hero, story, contact])

  const save = async () => {
    if (hero) {
      const body: ContentBlockCreate = { block_type: 'hero', schema_version: '1', data: heroData, sort_order: hero.sort_order }
      await updateHero.mutateAsync(body)
    }
    if (story) {
      const body: ContentBlockCreate = { block_type: 'story', schema_version: '1', data: storyData, sort_order: story.sort_order }
      await updateStory.mutateAsync(body)
    }
    if (contact) {
      const body: ContentBlockCreate = { block_type: 'contact', schema_version: '1', data: contactData, sort_order: contact.sort_order }
      await updateContact.mutateAsync(body)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-bold">Business info</h1>
      <Card>
        <h2 className="font-semibold text-lg mb-4">Hero</h2>
        <div className="space-y-4">
          <Field id="hero-headline" label="Headline">
            <Input id="hero-headline" value={heroData.headline} onChange={(e) => setHeroData((d) => ({ ...d, headline: e.target.value }))} />
          </Field>
          <Field id="hero-subheadline" label="Subheadline">
            <Input id="hero-subheadline" value={heroData.subheadline || ''} onChange={(e) => setHeroData((d) => ({ ...d, subheadline: e.target.value }))} />
          </Field>
          <Field id="hero-cta" label="CTA text">
            <Input id="hero-cta" value={heroData.cta_text || ''} onChange={(e) => setHeroData((d) => ({ ...d, cta_text: e.target.value }))} />
          </Field>
        </div>
      </Card>
      <Card>
        <h2 className="font-semibold text-lg mb-4">Story</h2>
        <div className="space-y-4">
          <Field id="story-headline" label="Headline">
            <Input id="story-headline" value={storyData.headline} onChange={(e) => setStoryData((d) => ({ ...d, headline: e.target.value }))} />
          </Field>
          <Field id="story-body" label="Body">
            <Textarea id="story-body" value={storyData.body} onChange={(e) => setStoryData((d) => ({ ...d, body: e.target.value }))} rows={5} />
          </Field>
        </div>
      </Card>
      <Card>
        <h2 className="font-semibold text-lg mb-4">Contact</h2>
        <div className="space-y-4">
          <Field id="contact-email" label="Email">
            <Input id="contact-email" type="email" value={contactData.email || ''} onChange={(e) => setContactData((d) => ({ ...d, email: e.target.value }))} />
          </Field>
          <Field id="contact-phone" label="Phone">
            <Input id="contact-phone" type="tel" value={contactData.phone || ''} onChange={(e) => setContactData((d) => ({ ...d, phone: e.target.value }))} />
          </Field>
        </div>
      </Card>
      <Button onClick={save} loading={updateHero.isPending || updateStory.isPending || updateContact.isPending}>Save changes</Button>
    </div>
  )
}
