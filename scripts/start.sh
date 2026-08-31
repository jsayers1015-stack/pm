#!/usr/bin/env bash
# Start the app in Docker. Works on Mac and Linux.
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose up --build -d
echo "Running at http://localhost:8000"
