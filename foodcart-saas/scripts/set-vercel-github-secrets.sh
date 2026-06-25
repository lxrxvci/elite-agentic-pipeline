#!/usr/bin/env bash
# Set the Vercel-related GitHub secrets for this repository.
# Run from the repo root with `gh` authenticated.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: GitHub CLI (gh) is not installed."
  exit 1
fi

if [ -z "${VERCEL_TOKEN:-}" ]; then
  echo -n "VERCEL_TOKEN: "
  read -rs VERCEL_TOKEN
  echo
fi

ORG_ID="team_5NBoD8CCbWekEbrdn1Ixq8cR"

# Project IDs for foodcart-saas (created 2026-06-25).
BACKEND_ID="prj_ZQlUc6TirK4zaGNEhzalxlWllrgX"
FRONTEND_ID="prj_dEfninplCiPDYY5oHb0vZh8iNOAA"
BACKEND_STAGING_ID="prj_mZRZekIwUXq04UKJxH3qfW5L3HOf"
FRONTEND_STAGING_ID="prj_lmc3FDjzeiCWR7WDsxoSeza2ZuSY"

set_secret() {
  local name="$1"
  local value="$2"
  echo "Setting $name..."
  printf '%s' "$value" | gh secret set "$name"
}

set_secret "VERCEL_TOKEN" "$VERCEL_TOKEN"
set_secret "VERCEL_ORG_ID" "$ORG_ID"
set_secret "VERCEL_PROJECT_ID_BACKEND" "$BACKEND_ID"
set_secret "VERCEL_PROJECT_ID_FRONTEND" "$FRONTEND_ID"
set_secret "VERCEL_PROJECT_ID_BACKEND_STAGING" "$BACKEND_STAGING_ID"
set_secret "VERCEL_PROJECT_ID_FRONTEND_STAGING" "$FRONTEND_STAGING_ID"

echo "Vercel project secrets set."
echo ""
echo "Next, set the database secrets:"
echo "  STAGING_DATABASE_URL"
echo "  PRODUCTION_DATABASE_URL"
echo ""
echo "And the AI assistant secret:"
echo "  GEMINI_API_KEY"
