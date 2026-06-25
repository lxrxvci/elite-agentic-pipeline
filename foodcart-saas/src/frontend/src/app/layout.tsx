'use client'

import { Inter, Rubik } from 'next/font/google'
import { usePathname } from 'next/navigation'
import './globals.css'
import { QueryProvider } from './providers'
import { ToastProvider } from '@/shared/ui'
import { Layout } from '@/widgets/Layout/Layout'
import { ErrorBoundary } from '@/shared/ui/ErrorBoundary'
import { WebVitalsInit } from '@/shared/ui/WebVitalsInit'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const rubik = Rubik({ subsets: ['latin'], variable: '--font-rubik' })

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const pathname = usePathname() ?? ''
  const isFoodcartRoute = pathname.startsWith('/admin') || pathname.startsWith('/sites')

  return (
    <html lang="en">
      <body className={`${inter.variable} ${rubik.variable} font-body`}>
        <ErrorBoundary>
          <QueryProvider>
            <ToastProvider>
              {isFoodcartRoute ? (
                <>
                  <WebVitalsInit />
                  {children}
                </>
              ) : (
                <Layout>
                  <WebVitalsInit />
                  {children}
                </Layout>
              )}
            </ToastProvider>
          </QueryProvider>
        </ErrorBoundary>
      </body>
    </html>
  )
}
