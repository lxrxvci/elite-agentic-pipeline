export type TemplateId = 'banhmi' | 'real-indian' | 'mis-abuelos' | 'custom'

export type BlockType =
  | 'hero'
  | 'story'
  | 'menu'
  | 'locations'
  | 'catering'
  | 'contact'
  | 'order_links'
  | 'footer'

export interface Tenant {
  id: string
  name: string
  slug: string
  status: 'active' | 'suspended' | 'archived'
  billing_status: 'trial' | 'active' | 'past_due' | 'canceled'
  plan: string
  billing_interval: 'month' | 'year' | null
  subscription_status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'paused' | null
  subscription_current_period_start: string | null
  subscription_current_period_end: string | null
  trial_ends_at: string | null
  canceled_at: string | null
  created_at: string
  updated_at: string
}

export interface SeoMeta {
  title?: string
  description?: string
  favicon_url?: string
}

export interface BrandColors {
  primary: string
  secondary: string
  background: string
}

export interface Site {
  id: string
  tenant_id: string
  slug: string
  template_id: TemplateId
  publish_state: 'draft' | 'published'
  seo?: SeoMeta
  brand_colors?: BrandColors
  custom_domain?: string | null
  domain_status?: string | null
  domain_provider?: string | null
  created_at: string
  updated_at: string
}

export interface ContentBlock<T = unknown> {
  id: string
  site_id: string
  tenant_id: string
  block_type: BlockType
  schema_version: string
  data: T
  sort_order: number
  created_at: string
  updated_at: string
}

export interface MenuItem {
  name: string
  description?: string
  price: string
  image_url?: string
  tags?: string[]
}

export interface MenuCategory {
  title: string
  items: MenuItem[]
}

export interface SocialLink {
  platform: 'google' | 'yelp' | 'instagram' | 'facebook' | 'tiktok' | 'website'
  url: string
}

export interface OrderLink {
  platform: 'doordash' | 'ubereats' | 'grubhub' | 'website' | 'phone'
  url: string
}

export interface Location {
  name: string
  address: string
  phone: string
  note?: string
  hours: Record<string, string>
  timezone: string
  map_url?: string
}

export interface HeroBlockData {
  headline: string
  subheadline?: string
  cta_text?: string
  cta_url?: string
  image_url?: string
  status_badge?: boolean
}

export interface StoryBlockData {
  headline: string
  body: string
  image_url?: string
  quote?: string
}

export interface MenuBlockData {
  categories: MenuCategory[]
  featured?: MenuItem[]
}

export interface LocationsBlockData {
  locations: Location[]
}

export interface CateringBlockData {
  headline: string
  body: string
  cta_text?: string
}

export interface ContactBlockData {
  email?: string
  phone?: string
}

export interface OrderLinksBlockData {
  links: OrderLink[]
}

export interface FooterBlockData {
  social_links: SocialLink[]
  copyright?: string
}

export interface SlugCheckRequest {
  slug: string
}

export interface SlugCheckResponse {
  slug: string
  available: boolean
  normalized_slug?: string
  suggestions?: string[]
}

export interface TenantOnboardingRequest {
  business_name: string
  slug: string
  template_id: TemplateId
  brand_colors: BrandColors
  initial_sources?: IngestionRequest
}

export interface TenantOnboardingResponse {
  tenant: Tenant
  site: Site
}

export interface SiteCreate {
  slug: string
  template_id: TemplateId
  seo?: SeoMeta
  brand_colors?: BrandColors
}

export interface SiteUpdate {
  template_id?: TemplateId
  publish_state?: 'draft' | 'published'
  seo?: SeoMeta
  brand_colors?: BrandColors
  custom_domain?: string | null
}

export interface ConnectDomainRequest {
  domain: string
  provider?: 'external' | 'cloudflare' | 'namecheap'
}

export interface DomainStatus {
  domain: string
  status: 'none' | 'pending' | 'active' | 'error'
  provider: string | null
  dns_verified: boolean
  dns_message: string | null
}

export interface DomainAvailability {
  name: string
  registrable: boolean
  currency: string
  registration_cost: string
  renewal_cost: string
  reason?: string | null
}

export interface DomainSearchResponse {
  query: string
  domains: DomainAvailability[]
}

export interface DomainPurchaseRequest {
  domain: string
}

export interface DomainPurchaseResponse {
  checkout_url: string
  domain: string
  total: string
  currency: string
}

export interface ContentBlockCreate<T = unknown> {
  block_type: BlockType
  schema_version: string
  data: T
  sort_order: number
}

export interface IngestionRequest {
  google_business_url?: string
  yelp_url?: string
  menu_url?: string
  website_url?: string
  social_links?: SocialLink[]
  order_links?: OrderLink[]
}

export interface IngestionJob {
  id: string
  site_id: string
  source_type: string
  source_url: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  normalized_data?: object | null
  errors?: string[]
  created_at: string
}

export interface AIProposeRequest {
  prompt: string
}

export interface PatchOperation {
  op: 'add' | 'replace' | 'remove'
  path: string
  value?: unknown
}

export interface AIProposeResponse {
  proposal_id: string
  summary: string
  in_scope: boolean
  confidence?: number
  operations: PatchOperation[]
}

export interface AIApplyRequest {
  proposal_id: string
  confirmed: boolean
}

export interface Revision {
  id: string
  site_id: string
  triggered_by: string
  source: 'manual' | 'ai' | 'ingestion' | 'revert'
  ai_request_id?: string | null
  snapshot: object
  created_at: string
}

export interface PublicSite {
  slug: string
  template_id: TemplateId
  publish_state: 'draft' | 'published'
  seo?: SeoMeta
  brand_colors?: BrandColors
  blocks: ContentBlock[]
}

export type BillingInterval = 'month' | 'year'

export interface Plan {
  id: string
  name: string
  interval: BillingInterval
  price_usd: string
}

export interface BillingPlans {
  monthly: Plan
  yearly: Plan
}

export interface CheckoutRequest {
  interval: BillingInterval
}

export interface CheckoutResponse {
  checkout_url: string
}

export interface PortalResponse {
  url: string
}

export interface Subscription {
  plan: string
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'paused' | null
  billing_interval: BillingInterval | null
  current_period_start: string | null
  current_period_end: string | null
  trial_ends_at: string | null
  canceled_at: string | null
  paddle_subscription_id: string | null
  paddle_customer_id: string | null
}
