'use client'

import { useEffect, useState } from 'react'
import { Button, Card, Field, Input, Switch } from '@/shared/ui'
import { useSites } from '../api/useSites'
import { useBlocks } from '../api/useBlocks'
import { useUpdateBlock } from '../api/useUpdateBlock'
import type { LocationsBlockData, ContentBlockCreate } from '@/shared/api/foodcart-types'

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export function HoursEditor() {
  const { data: sites } = useSites()
  const siteId = sites?.[0]?.id
  const { data: blocksData } = useBlocks(siteId)
  const locationsBlock = blocksData?.blocks.find((b) => b.block_type === 'locations')
  const updateLocations = useUpdateBlock(siteId, locationsBlock?.id)

  const [locations, setLocations] = useState<LocationsBlockData['locations']>([])

  useEffect(() => {
    if (locationsBlock) {
      setLocations((locationsBlock.data as LocationsBlockData).locations)
    }
  }, [locationsBlock])

  const updateHours = (locationIndex: number, day: string, value: string) => {
    setLocations((prev) => {
      const next = [...prev]
      next[locationIndex] = { ...next[locationIndex], hours: { ...next[locationIndex].hours, [day]: value } }
      return next
    })
  }

  const toggleDay = (locationIndex: number, day: string, open: boolean) => {
    updateHours(locationIndex, day, open ? '10:00 AM – 9:00 PM' : 'Closed')
  }

  const save = async () => {
    if (!locationsBlock) return
    const body: ContentBlockCreate = {
      block_type: 'locations',
      schema_version: '1',
      data: { locations },
      sort_order: locationsBlock.sort_order,
    }
    await updateLocations.mutateAsync(body)
  }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-bold">Hours</h1>
      {locations.map((location, li) => (
        <Card key={location.name}>
          <h2 className="font-semibold text-lg mb-4">{location.name}</h2>
          <div className="space-y-3">
            {DAY_NAMES.map((day) => {
              const isClosed = (location.hours[day] ?? 'Closed').toLowerCase() === 'closed'
              return (
                <div key={day} className="flex items-center gap-4">
                  <span className="w-24 text-sm font-medium">{day}</span>
                  <Switch
                    checked={!isClosed}
                    onCheckedChange={(checked) => toggleDay(li, day, checked)}
                    aria-label={`${day} open`}
                  />
                  <Input
                    value={location.hours[day] || ''}
                    onChange={(e) => updateHours(li, day, e.target.value)}
                    disabled={isClosed}
                    className="max-w-xs"
                    placeholder="10:00 AM – 9:00 PM"
                  />
                </div>
              )
            })}
          </div>
        </Card>
      ))}
      <Button onClick={save} loading={updateLocations.isPending}>Save hours</Button>
    </div>
  )
}
