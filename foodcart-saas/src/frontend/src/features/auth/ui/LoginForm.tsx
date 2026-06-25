'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiClient } from '@/shared/api/client'
import { Button, Input } from '@/shared/ui'
import { useAuthStore } from '../model/store'

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated)
  const router = useRouter()

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      await apiClient<{ access_token: string; token_type: string }>('/auth/token', {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
      setAuthenticated(true)
      router.push('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-lg border border-elite-border bg-elite-white p-6 shadow-card">
      <h1 className="text-2xl font-bold text-elite-text-primary">Sign in</h1>
      <div>
        <label htmlFor="login-email" className="mb-1 block text-sm font-medium text-elite-text-primary">Email</label>
        <Input
          id="login-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      {error && <p className="text-sm text-elite-danger">{error}</p>}
      <Button type="submit" loading={loading} className="w-full">
        Sign in
      </Button>
      <p className="text-sm text-elite-text-secondary">
        Dev mode: any email creates a tenant and returns a session cookie.
      </p>
    </form>
  )
}
