'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Field, Input } from '@/shared/ui'
import { useAuthStore } from '@/features/auth/model/store'

export default function AdminLoginPage() {
  const router = useRouter()
  const setToken = useAuthStore((s) => s.setToken)
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated)
  const [token, setTokenValue] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!token.trim()) {
      setError('Please enter a Clerk token.')
      return
    }
    setToken(token.trim())
    setAuthenticated(true)
    router.push('/admin/dashboard')
  }

  return (
    <div className="min-h-screen bg-fc-neutral-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8">
        <h1 className="font-display text-2xl font-bold mb-2">Foodcart Admin</h1>
        <p className="text-fc-text-secondary mb-6">Sign in with your Clerk session token.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field id="token" label="Clerk token" error={error} required>
            <Input
              id="token"
              type="password"
              value={token}
              onChange={(e) => setTokenValue(e.target.value)}
              placeholder="eyJ..."
            />
          </Field>
          <Button type="submit" className="w-full">Sign in</Button>
        </form>
      </Card>
    </div>
  )
}
