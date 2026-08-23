#!/bin/sh
# Backend entrypoint: apply database migrations, then serve.
# Fresh databases (CI, staging, prod) must always come up with current schema.
set -e

echo "==> Running database migrations (alembic upgrade head)"
alembic upgrade head

echo "==> Starting uvicorn"
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}"
