import { CANARY_API_URL_COOKIE } from '../lib/canary'
import { useAuthStore } from '@/features/auth/model/store'

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

export async function apiClient<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const baseUrl = getApiBaseUrl()
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`

  // Read the short-lived Clerk token from memory (set by ClerkAdminAuthProvider).
  // Legacy dev auth relies on the httpOnly elite_session cookie instead.
  const token = typeof window === 'undefined' ? null : useAuthStore.getState().token
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers as Record<string, string>,
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  // When using cookie-based auth, include the CSRF token for state-changing requests.
  const method = (options.method || 'GET').toUpperCase()
  const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
  if (!token && mutatingMethods.has(method)) {
    const csrfToken = getCookieValue('csrf_token')
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken
    }
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

// Deprecated: the legacy token is no longer persisted in localStorage.
// Retaining a no-op setter avoids breaking existing call sites until they are updated.
export function setClerkToken(_token: string | null) {
  // no-op
}

export function getClerkToken(): string | null {
  if (typeof window === 'undefined') return null
  return useAuthStore.getState().token
}
