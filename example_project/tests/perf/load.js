import http from 'k6/http'
import { check, sleep } from 'k6'
import { randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js'

export const options = {
  scenarios: {
    health: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 50 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
      exec: 'healthCheck',
    },
    business: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 5 },
        { duration: '1m', target: 20 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
      exec: 'businessJourney',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>=0.99'],
  },
}

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000'
const API_URL = `${BASE_URL}/api/v1`

function healthCheck() {
  const res = http.get(`${API_URL}/health`)
  check(res, {
    'health status is 200': (r) => r.status === 200,
    'health response time < 500ms': (r) => r.timings.duration < 500,
  })
  sleep(1)
}

function devLogin() {
  const email = `load-${randomString(8)}@example.com`
  const res = http.post(
    `${API_URL}/auth/token`,
    JSON.stringify({ email }),
    { headers: { 'Content-Type': 'application/json' } }
  )
  check(res, {
    'login status is 200': (r) => r.status === 200,
  })
  return res.json('access_token')
}

function businessJourney() {
  const token = devLogin()
  if (!token) {
    return
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }

  // Create client
  const clientRes = http.post(
    `${API_URL}/clients`,
    JSON.stringify({
      name: `Client ${randomString(6)}`,
      email: `client-${randomString(6)}@example.com`,
      currency: 'USD',
      default_hourly_rate: '150.00',
    }),
    { headers }
  )
  check(clientRes, {
    'create client status is 201': (r) => r.status === 201,
  })
  const client = clientRes.json()
  if (!client || !client.id) {
    return
  }

  // Create project
  const projectRes = http.post(
    `${API_URL}/projects`,
    JSON.stringify({
      client_id: client.id,
      name: `Project ${randomString(6)}`,
      rounding_minutes: 15,
    }),
    { headers }
  )
  check(projectRes, {
    'create project status is 201': (r) => r.status === 201,
  })
  const project = projectRes.json()
  if (!project || !project.id) {
    return
  }

  // Create time entry
  const entryRes = http.post(
    `${API_URL}/time-entries`,
    JSON.stringify({
      client_id: client.id,
      project_id: project.id,
      description: `Load test entry ${randomString(6)}`,
      duration_minutes: 60,
    }),
    { headers }
  )
  check(entryRes, {
    'create time entry status is 201': (r) => r.status === 201,
  })

  // List clients (read path)
  const listRes = http.get(`${API_URL}/clients`, { headers })
  check(listRes, {
    'list clients status is 200': (r) => r.status === 200,
  })

  sleep(1)
}

export { healthCheck, businessJourney }
