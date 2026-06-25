/** @type {import('next').NextConfig} */

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const apiOrigin = apiUrl ? new URL(apiUrl).origin : "'self'"

const clerkOrigin = 'https://clerk.web.agenticpnw.com'
const clerkDevOrigin = 'https://*.clerk.accounts.dev'

const cspHeader = (
  "default-src 'self'; " +
  `script-src 'self' 'unsafe-inline' ${clerkOrigin} ${clerkDevOrigin}; ` +
  `style-src 'self' 'unsafe-inline' ${clerkOrigin} ${clerkDevOrigin}; ` +
  `img-src 'self' data: blob: https://img.clerk.com ${clerkOrigin}; ` +
  `font-src 'self' ${clerkOrigin} ${clerkDevOrigin}; ` +
  `connect-src 'self' ${apiOrigin} ${clerkOrigin} ${clerkDevOrigin}; ` +
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
