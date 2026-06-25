import { describe, expect, it } from 'vitest'
import { getTemplate, TEMPLATES } from './templates'

describe('templates', () => {
  it('lists three templates', () => {
    expect(TEMPLATES).toHaveLength(3)
  })

  it('finds template by id', () => {
    expect(getTemplate('banhmi').id).toBe('banhmi')
    expect(getTemplate('real-indian').id).toBe('real-indian')
  })
})
