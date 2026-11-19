export interface ContactBusinessAssociation {
  id: number | null
  name: string
}

export interface ContactChannel {
  value: string
  /** Original single-business fields, retained for previously saved intakes. */
  businessId?: number | null
  businessName?: string | null
  /** One person, one channel, any number of associated businesses. */
  businesses?: ContactBusinessAssociation[]
}

export interface ContactChannelLink extends ContactChannel {
  kind: 'email' | 'phone'
}

export function contactChannelBusinesses(channel: ContactChannel): ContactBusinessAssociation[] {
  const associations = channel.businesses ?? (channel.businessName
    ? [{ id: channel.businessId ?? null, name: channel.businessName }]
    : [])
  const seen = new Set<string>()
  return associations.flatMap((association) => {
    const name = association.name.trim()
    if (!name) return []
    const key = association.id == null ? `name:${name.toLowerCase()}` : `id:${association.id}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{ id: association.id ?? null, name }]
  })
}
