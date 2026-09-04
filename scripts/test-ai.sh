#!/usr/bin/env bash
# Run the opt-in live OpenRouter tests. Needs OPENROUTER_API_KEY in .env.
set -euo pipefail
cd "$(dirname "$0")/.."

docker run --rm \
  --env-file .env \
  -v "$PWD/backend:/app" \
  -v pm-uv-cache:/root/.cache/uv \
  -e UV_PROJECT_ENVIRONMENT=/tmp/venv \
  -e UV_LINK_MODE=copy \
  -w /app \
  ghcr.io/astral-sh/uv:python3.14-bookworm-slim \
  uv run --frozen pytest -m live -s "$@"
