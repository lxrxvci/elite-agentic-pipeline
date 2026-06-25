import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SocialLinks } from './SocialLinks'

describe('SocialLinks', () => {
  it('renders accessible social links', () => {
    render(
      <SocialLinks
        links={[
          { platform: 'instagram', url: 'https://instagram.com/tacos' },
          { platform: 'yelp', url: 'https://yelp.com/tacos' },
        ]}
      />
    )
    expect(screen.getByLabelText('Instagram')).toHaveAttribute('href', 'https://instagram.com/tacos')
    expect(screen.getByLabelText('Yelp')).toHaveAttribute('href', 'https://yelp.com/tacos')
  })
})
