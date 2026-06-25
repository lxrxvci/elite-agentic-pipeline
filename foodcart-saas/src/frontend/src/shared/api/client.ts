import { CANARY_API_URL_COOKIE } from '../lib/canary'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

export interface ProblemDetail {
  type?: string
  title: string
  status: number
  detail?: string
  errors?: Array<{ loc: string[]; msg: string; type: string }>
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public problem?: ProblemDetail
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function getCookieValue(name: string): string | undefined {
  if (typeof document === 'undefined') {
    return undefined
  }
  const match = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : undefined
}

function getApiBaseUrl(): string {
  return getCookieValue(CANARY_API_URL_COOKIE) || API_BASE_URL
}

function getAuthToken(): string | undefined {
  if (typeof window === 'undefined') return undefined
  // Clerk token is injected by the auth provider; fall back to a localStorage debug token in tests
  try {
    return window.localStorage.getItem('__fc_clerk_token') || undefined
  } catch {
    return undefined
  }
}

export async function apiClient<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const baseUrl = getApiBaseUrl()
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`

  const token = getAuthToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers as Record<string, string>,
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const problem: ProblemDetail = {
      title: body.title || `HTTP ${response.status}`,
      status: response.status,
      detail: body.detail,
      type: body.type,
      errors: body.errors,
    }
    throw new ApiError(problem.detail || problem.title, response.status, problem)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

export function setClerkToken(token: string | null) {
  if (typeof window === 'undefined') return
  try {
    if (token) {
      window.localStorage.setItem('__fc_clerk_token', token)
    } else {
      window.localStorage.removeItem('__fc_clerk_token')
    }
  } catch {
    // ignore
  }
}

export function getClerkToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem('__fc_clerk_token')
  } catch {
    return null
  }
}
