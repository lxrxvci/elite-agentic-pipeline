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
        // Current baseline (Phase 1 remediation): ~63% lines/statements, ~74% functions.
        statements: 62,
        branches: 78,
        functions: 74,
        lines: 62,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
