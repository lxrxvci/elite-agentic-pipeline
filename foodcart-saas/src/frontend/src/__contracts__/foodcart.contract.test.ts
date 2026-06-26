import { describe, it, expect } from 'vitest'
import { Pact, MatchersV3 } from '@pact-foundation/pact'
import path from 'path'

const provider = new Pact({
  consumer: 'elite-frontend',
  provider: 'elite-backend',
  port: 1235,
  dir: path.resolve(process.cwd(), 'pacts', 'foodcart'),
  logLevel: 'warn',
})

const TEST_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMTExMTExMS0xMTExLTExMTEtMTExMS0xMTExMTExMTExMTEiLCJlbWFpbCI6ImNvbnRyYWN0QGV4YW1wbGUuY29tIiwibmFtZSI6IkNvbnRyYWN0IFVzZXIiLCJ0ZW5hbnRfaWQiOiIyMjIyMjIyMi0yMjIyLTIyMjItMjIyMi0yMjIyMjIyMjIyMjIiLCJleHAiOjE4OTM0NTYwMDB9.qbwzTcMw9rHWkdvE3YTQhdSlhOka8_th62Yk9gGEPjc'

const uuidMatcher = MatchersV3.uuid('11111111-1111-1111-1111-111111111111')
const isoTimestampMatcher = MatchersV3.timestamp(
  "yyyy-MM-dd'T'HH:mm:ss.SSSSSS",
  '2026-06-24T12:00:00.000000'
)

const tenantShape = {
  id: uuidMatcher,
  name: MatchersV3.string('Contract Tenant'),
  slug: MatchersV3.string('contract-bites'),
  status: MatchersV3.string('active'),
  billing_status: MatchersV3.string('trial'),
  created_at: isoTimestampMatcher,
  updated_at: isoTimestampMatcher,
}

const siteShape = {
  id: uuidMatcher,
  tenant_id: uuidMatcher,
  slug: MatchersV3.string('contract-bites'),
  template_id: MatchersV3.string('custom'),
  publish_state: MatchersV3.string('published'),
  seo: MatchersV3.like({ title: 'Contract Bites', description: 'Tasty contract food' }),
  brand_colors: MatchersV3.like({
    primary: '#2563eb',
    secondary: '#f5f5f5',
    background: '#ffffff',
  }),
  custom_domain: MatchersV3.nullValue(),
  created_at: isoTimestampMatcher,
  updated_at: isoTimestampMatcher,
}

const blockShape = {
  id: uuidMatcher,
  site_id: uuidMatcher,
  tenant_id: uuidMatcher,
  block_type: MatchersV3.string('hero'),
  schema_version: MatchersV3.string('1.0'),
  data: MatchersV3.like({ headline: 'Contract Bites' }),
  sort_order: MatchersV3.integer(0),
  created_at: isoTimestampMatcher,
  updated_at: isoTimestampMatcher,
}

describe('Foodcart API contract', () => {
  it('onboards a new tenant and site', async () => {
    await provider
      .addInteraction()
      .given('an authenticated owner exists')
      .uponReceiving('a request to onboard a new foodcart tenant')
      .withRequest('POST', '/api/v1/tenants/onboard', (builder) => {
        builder.headers({
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TEST_TOKEN}`,
        })
        builder.jsonBody({
          business_name: 'Contract Bites',
          slug: 'contract-bites',
          template_id: 'custom',
          brand_colors: {
            primary: '#2563eb',
            secondary: '#f5f5f5',
            background: '#ffffff',
          },
        })
      })
      .willRespondWith(201, (builder) => {
        builder.headers({ 'Content-Type': 'application/json' })
        builder.jsonBody({
          tenant: tenantShape,
          site: siteShape,
        })
      })
      .executeTest(async (mockServer) => {
        const response = await fetch(`${mockServer.url}/api/v1/tenants/onboard`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${TEST_TOKEN}`,
          },
          body: JSON.stringify({
            business_name: 'Contract Bites',
            slug: 'contract-bites',
            template_id: 'custom',
            brand_colors: {
              primary: '#2563eb',
              secondary: '#f5f5f5',
              background: '#ffffff',
            },
          }),
        })

        expect(response.status).toBe(201)
        const data = await response.json()
        expect(data.tenant.slug).toBe('contract-bites')
        expect(data.site.template_id).toBe('custom')
      })
  })

  it('lists sites for the authenticated tenant', async () => {
    await provider
      .addInteraction()
      .given('a tenant and published site exist')
      .uponReceiving('a request to list sites')
      .withRequest('GET', '/api/v1/sites', (builder) => {
        builder.headers({ Authorization: `Bearer ${TEST_TOKEN}` })
      })
      .willRespondWith(200, (builder) => {
        builder.headers({ 'Content-Type': 'application/json' })
        builder.jsonBody(MatchersV3.eachLike(siteShape))
      })
      .executeTest(async (mockServer) => {
        const response = await fetch(`${mockServer.url}/api/v1/sites`, {
          headers: { Authorization: `Bearer ${TEST_TOKEN}` },
        })

        expect(response.status).toBe(200)
        const data = await response.json()
        expect(Array.isArray(data)).toBe(true)
        expect(data[0].slug).toBe('contract-bites')
      })
  })

  it('returns a published public site by slug', async () => {
    await provider
      .addInteraction()
      .given('a tenant and published site exist')
      .uponReceiving('a request for the public site by slug')
      .withRequest('GET', '/api/v1/public/sites/contract-bites', (builder) => {
        builder.headers({})
      })
      .willRespondWith(200, (builder) => {
        builder.headers({ 'Content-Type': 'application/json' })
        builder.jsonBody({
          slug: MatchersV3.string('contract-bites'),
          template_id: MatchersV3.string('custom'),
          publish_state: MatchersV3.string('published'),
          seo: MatchersV3.like({ title: 'Contract Bites' }),
          brand_colors: MatchersV3.like({
            primary: '#2563eb',
            secondary: '#f5f5f5',
            background: '#ffffff',
          }),
          blocks: MatchersV3.eachLike(blockShape),
        })
      })
      .executeTest(async (mockServer) => {
        const response = await fetch(`${mockServer.url}/api/v1/public/sites/contract-bites`)

        expect(response.status).toBe(200)
        const data = await response.json()
        expect(data.slug).toBe('contract-bites')
        expect(data.blocks).toBeDefined()
      })
  })
})
