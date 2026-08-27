#!/bin/bash
# Syncs the domain core into the vendored copy the frontend depends on.
# packages/domain is the source of truth; vendor/domain exists because
# Vercel builds cannot reach file: dependencies outside the project root.
# CI check: scripts/check-domain-sync.sh fails when they drift.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p ../src/frontend/vendor/domain
rsync -a --delete ../packages/domain/src ../src/frontend/vendor/domain/src
cp ../packages/domain/package.json ../src/frontend/vendor/domain/package.json
echo "domain synced to src/frontend/vendor/domain"
