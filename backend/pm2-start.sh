#!/usr/bin/env bash
set -euo pipefail

# Move to repo root (this script lives in backend/)
cd "$(dirname "$0")/.."


# Activate Python venv: prefer VENV_DIR if provided, else .venv, else system Python
if [[ -n "${VENV_DIR:-}" && -d "${VENV_DIR}" ]]; then
  echo "[pm2-start] Activating venv: ${VENV_DIR}"
  # shellcheck disable=SC1090
  source "${VENV_DIR}/bin/activate"
elif [[ -d .venv ]]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
else
  echo "[pm2-start] No venv found; running with system Python"
fi

# Load .env if present (simple KEY=VAL format)
if [[ -f .env ]]; then
  set -o allexport
  # shellcheck disable=SC1091
  source .env
  set +o allexport
fi

# Run Prisma generate/migrate when DATABASE_URL is configured (inside active env)
if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "[pm2-start] Running Prisma generate/migrate..."
  prisma generate || true
  prisma migrate deploy || true
fi

PORT="${PORT:-8002}"
WORKERS="${WORKERS:-2}"
echo "[pm2-start] Starting Uvicorn on 0.0.0.0:${PORT} (workers=${WORKERS})"
exec uvicorn backend.api:app --host 0.0.0.0 --port "${PORT}" --workers "${WORKERS}"
