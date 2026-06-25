#!/usr/bin/env bash
# Load repository secrets from .env.github-secrets into GitHub Actions.
# Usage: VERCEL_TOKEN=<token> ./scripts/set-github-secrets.sh
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: GitHub CLI (gh) is not installed."
  exit 1
fi

if [ ! -f .env.github-secrets ]; then
  echo "Error: .env.github-secrets not found."
  exit 1
fi

if [ -z "${VERCEL_TOKEN:-}" ]; then
  echo -n "VERCEL_TOKEN: "
  read -rs VERCEL_TOKEN
  echo
fi

# Set VERCEL_TOKEN separately because it is not in .env.github-secrets.
echo "$VERCEL_TOKEN" | gh secret set VERCEL_TOKEN

# Set everything else from the env file.
while IFS='=' read -r key value; do
  # Skip comments and blank lines.
  [[ "$key" =~ ^#.*$ ]] && continue
  [[ -z "$key" ]] && continue
  echo "Setting $key..."
  printf '%s' "$value" | gh secret set "$key"
done < .env.github-secrets

echo "All GitHub secrets set."
echo ""
echo "Next: add GitHub variables (STAGING_API_URL, PRODUCTION_API_URL, GEMINI_MODEL, etc.)"
echo "       and configure the staging/production environments."
