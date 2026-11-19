import { describe, expect, it } from 'vitest'

import { contactChannelBusinesses } from '../contact-channels'

describe('contact channel business associations', () => {
  it('reads legacy single-business channels without changing their meaning', () => {
    expect(contactChannelBusinesses({ value: 'wren@example.com', businessId: 7, businessName: 'First Co' })).toEqual([
      { id: 7, name: 'First Co' },
    ])
  })

  it('supports multiple businesses and deduplicates repeat links', () => {
    expect(contactChannelBusinesses({
      value: 'wren@example.com',
      businesses: [
        { id: 7, name: 'First Co' },
        { id: 8, name: 'Second Co' },
        { id: 7, name: 'First Co renamed' },
        { id: null, name: 'First Co' },
        { id: null, name: ' ' },
      ],
    })).toEqual([
      { id: 7, name: 'First Co' },
      { id: 8, name: 'Second Co' },
      { id: null, name: 'First Co' },
    ])
  })
})
