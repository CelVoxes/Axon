#!/usr/bin/env sh
set -e

# Generate Prisma client and run migrations if DATABASE_URL is provided
if [ -n "$DATABASE_URL" ]; then
  echo "Running Prisma generate and migrate..."
  prisma generate || true
  prisma migrate deploy || true
fi

exec uvicorn backend.api:app --host 0.0.0.0 --port 8000 --workers 2


