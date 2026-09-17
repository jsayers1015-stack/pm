#!/usr/bin/env bash
# Local dev with hot reload: uvicorn on 8000, next dev on 3000.
# Requires uv and node installed locally. Use scripts/start.sh for the Docker path.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v uv >/dev/null 2>&1; then
  echo "uv not found. Install it from https://docs.astral.sh/uv/getting-started/installation/" >&2
  echo "Or use scripts/start.sh to run in Docker instead." >&2
  exit 1
fi

export DB_PATH="${DB_PATH:-$PWD/backend/data/pm.db}"
mkdir -p "$(dirname "$DB_PATH")"

cleanup() {
  [[ -n "${backend_pid:-}" ]] && kill "$backend_pid" 2>/dev/null || true
}
trap cleanup EXIT

(cd backend && uv run --frozen --env-file ../.env uvicorn app.main:app --reload --port 8000) &
backend_pid=$!

cd frontend
npm run dev
