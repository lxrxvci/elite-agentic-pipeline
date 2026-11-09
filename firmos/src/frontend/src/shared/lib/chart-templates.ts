export type ChartTemplateKey = 'sole_proprietor' | 'partnership' | 'corporation'

export interface ChartTemplateNames {
  contributions: string
  distributions: string
  netInvestment: string
  grouped: string
}

export interface ChartAccountTemplate extends ChartTemplateNames {
  id: number
  key: ChartTemplateKey
  version: number
  status: 'draft' | 'approved' | 'retired'
  isActive: boolean
}

export function chartTemplateKeyFor(input: {
  taxStructure?: string | null
  llcSubclass?: string | null
}): ChartTemplateKey {
  const structure = (input.taxStructure ?? '').toLowerCase()
  const subclass = (input.llcSubclass ?? '').toLowerCase()
  if (subclass.includes('sml') || structure.includes('sole')) return 'sole_proprietor'
  if (subclass.includes('partnership') || structure.includes('partnership')) return 'partnership'
  return 'corporation'
}
