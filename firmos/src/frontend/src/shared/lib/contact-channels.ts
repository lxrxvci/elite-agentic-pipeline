export interface ContactChannel {
  value: string
  businessId?: number | null
  businessName?: string | null
}

export interface ContactChannelLink extends ContactChannel {
  kind: 'email' | 'phone'
}
