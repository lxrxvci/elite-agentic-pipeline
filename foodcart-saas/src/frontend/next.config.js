/** @type {import('next').NextConfig} */

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const apiOrigin = apiUrl ? new URL(apiUrl).origin : "'self'"

const clerkOrigin = 'https://clerk.web.agenticpnw.com'
const clerkAccountsOrigin = 'https://accounts.web.agenticpnw.com'
const clerkDevOrigin = 'https://*.clerk.accounts.dev'
const turnstileOrigin = 'https://challenges.cloudflare.com'

const storagePublicUrl = process.env.NEXT_PUBLIC_STORAGE_PUBLIC_URL
let storageImgOrigin = ''
if (storagePublicUrl) {
  try {
    storageImgOrigin = new URL(storagePublicUrl).origin
  } catch {
    // eslint-disable-next-line no-console
    console.warn('Invalid NEXT_PUBLIC_STORAGE_PUBLIC_URL:', storagePublicUrl)
  }
}

const cspHeader = (
  "default-src 'self'; " +
  `script-src 'self' 'unsafe-inline' ${clerkOrigin} ${clerkDevOrigin} ${turnstileOrigin}; ` +
  `style-src 'self' 'unsafe-inline' ${clerkOrigin} ${clerkDevOrigin}; ` +
  `img-src 'self' data: blob: https://img.clerk.com ${clerkOrigin}${storageImgOrigin ? ` ${storageImgOrigin}` : ''}; ` +
  `font-src 'self' ${clerkOrigin} ${clerkDevOrigin}; ` +
  `connect-src 'self' ${apiOrigin} ${clerkOrigin} ${clerkAccountsOrigin} ${clerkDevOrigin} ${turnstileOrigin}; ` +
  `frame-src 'self' ${turnstileOrigin}; ` +
  "worker-src 'self' blob:; " +
  "frame-ancestors 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self';"
)

const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: __dirname,
  images: {
    formats: ['image/avif', 'image/webp'],
  },

  experimental: {
    instrumentationHook: true,
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: cspHeader,
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig
