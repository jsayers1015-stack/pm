#!/usr/bin/env bash
# Stop the app. Add --volumes to also delete the database.
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose down "$@"
echo "Stopped"
