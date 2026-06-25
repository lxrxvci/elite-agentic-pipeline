import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    exclude: ['node_modules', 'e2e'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      thresholds: {
        // Ratchet: raise these as more tests are added. Baseline dropped
        // temporarily while the Foodcart frontend scaffold is being built out;
        // target is to return to ≥80% diff coverage on new code.
        statements: 68,
        branches: 78,
        functions: 76,
        lines: 68,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
