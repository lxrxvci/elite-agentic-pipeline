#!/bin/bash
# Fails when the vendored domain copy drifts from packages/domain.
set -euo pipefail
cd "$(dirname "$0")/.."
diff -r packages/domain/src src/frontend/vendor/domain/src >/dev/null
diff packages/domain/package.json src/frontend/vendor/domain/package.json >/dev/null
echo "domain vendor copy is in sync"
