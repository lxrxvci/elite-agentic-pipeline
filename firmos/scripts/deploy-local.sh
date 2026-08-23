#!/usr/bin/env bash
# Deploy to Vercel using the locally logged-in CLI.
# Usage: scripts/deploy-local.sh <backend|frontend> [--prod]
set -euo pipefail

cd "$(dirname "$0")/.."

TARGET="${1:-}"
PROD_FLAG=""
if [ "${2:-}" = "--prod" ]; then
  PROD_FLAG="--prod"
fi

case "$TARGET" in
  backend)
    cd src/backend
    echo "Deploying backend to Vercel..."
    vercel --yes $PROD_FLAG
    ;;
  frontend)
    cd src/frontend
    echo "Building frontend for local deploy..."
    # Set the API URL from the current environment or default to staging.
    NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-https://elite-backend-staging.vercel.app/api/v1}"
    export NEXT_PUBLIC_API_URL
    vercel build --yes
    echo "Deploying frontend to Vercel..."
    vercel --prebuilt --yes $PROD_FLAG
    ;;
  *)
    echo "Usage: $0 <backend|frontend> [--prod]"
    exit 1
    ;;
esac
