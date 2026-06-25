'use client'

import { SignUp } from '@clerk/nextjs'

export default function AdminSignUpPage() {
  return (
    <div className="min-h-screen bg-[#fafafa] flex items-center justify-center p-4">
      <SignUp
        routing="hash"
        signInUrl="/admin/login"
        fallbackRedirectUrl="/admin/onboarding"
        appearance={{
          elements: {
            card: 'shadow-elevated',
            formButtonPrimary: 'bg-[#6161FF] hover:bg-[#4f4fdb]',
          },
        }}
      />
    </div>
  )
}
