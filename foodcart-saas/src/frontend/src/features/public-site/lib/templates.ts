import type { TemplateId } from '@/shared/api/foodcart-types'

export interface TemplateDefinition {
  id: TemplateId
  name: string
  mood: string
  thumbnail: string
  fontClass: string
}

export const TEMPLATES: TemplateDefinition[] = [
  {
    id: 'banhmi',
    name: 'Banh Mi Fusion',
    mood: 'Bold diagonal energy',
    thumbnail: '/templates/banhmi-thumb.svg',
    fontClass: 'font-display',
  },
  {
    id: 'real-indian',
    name: 'Real Indian Food',
    mood: 'Warm heritage storytelling',
    thumbnail: '/templates/real-indian-thumb.svg',
    fontClass: 'font-display',
  },
  {
    id: 'mis-abuelos',
    name: 'Mis Abuelos',
    mood: 'Family Mexican warmth',
    thumbnail: '/templates/mis-abuelos-thumb.svg',
    fontClass: 'font-display',
  },
]

export function getTemplate(id: TemplateId) {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]
}
