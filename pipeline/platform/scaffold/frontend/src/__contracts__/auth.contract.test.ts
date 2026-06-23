import { describe, it, expect } from 'vitest'
import { Pact } from '@pact-foundation/pact'
import { MatchersV3 } from '@pact-foundation/pact'
import path from 'path'

const provider = new Pact({
  consumer: 'elite-frontend',
  provider: 'elite-backend',
  port: 1234,
  dir: path.resolve(process.cwd(), 'pacts'),
  logLevel: 'warn',
})

describe('Auth API contract', () => {
  it('returns a token for valid dev credentials', async () => {
    await provider
      .addInteraction()
      .given('dev auth is enabled')
      .uponReceiving('a request for a dev token')
      .withRequest('POST', '/api/v1/auth/token', (builder) => {
        builder.headers({ 'Content-Type': 'application/json' })
        builder.jsonBody({ email: 'test@example.com' })
      })
      .willRespondWith(200, (builder) => {
        builder.headers({ 'Content-Type': 'application/json' })
        builder.jsonBody({
          access_token: MatchersV3.string('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test'),
          token_type: 'bearer',
        })
      })
      .executeTest(async (mockServer) => {
        const response = await fetch(`${mockServer.url}/api/v1/auth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'test@example.com' }),
        })

        expect(response.status).toBe(200)
        const data = await response.json()
        expect(data.token_type).toBe('bearer')
        expect(data.access_token).toBeDefined()
      })
  })
})
