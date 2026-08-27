import type { Metadata } from 'next'
import { Inter, Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'

import { Toaster } from '@/components/ui/sonner'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta' })

export const metadata: Metadata = {
  title: 'FirmOS - Bookkeeping Firm OS',
  description: 'Practice-management OS for a bookkeeping firm.',
}

/*
 * No-FOUC theme bootstrap - runs before first paint. Mirrors
 * resolveTheme() in src/shared/lib/theme.ts: explicit localStorage
 * choice wins, otherwise follow prefers-color-scheme.
 * CSP allows inline scripts (script-src 'unsafe-inline').
 */
const themeBootstrap = `(function(){try{var t=localStorage.getItem('firmos-theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d)}catch(e){}})()`

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className={`${inter.variable} ${jakarta.variable} font-sans`}>
        {children}
        <Toaster />
      </body>
    </html>
  )
}
