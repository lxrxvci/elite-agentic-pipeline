import { execSync } from 'node:child_process'

/** Re-seed the dev database so every e2e run starts from the known world. */
export default function globalSetup(): void {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://lxrxcvi@localhost:5432/firmos'
  execSync('npm run db:seed', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  })
}
