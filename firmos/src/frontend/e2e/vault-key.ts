/**
 * Phase 3B vault: BOTH e2e servers and the global-setup seed must share one
 * AES-256-GCM key so a credential saved through the dev server (3201) or
 * encrypted at seed time decrypts on the production server (3200). Throwaway
 * e2e-only value (base64 of 32 bytes), never deployed.
 */
export const VAULT_E2E_KEY = 'ZmlybW9zLWUyZS1vbmx5LXZhdWx0LWtleS0zMmJ5dGU='
