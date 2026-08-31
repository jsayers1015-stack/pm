# Run backend tests in a container, so no local Python or uv is needed.
Set-Location (Join-Path $PSScriptRoot "..")

docker run --rm `
  -v "${PWD}\backend:/app" `
  -v pm-uv-cache:/root/.cache/uv `
  -e UV_PROJECT_ENVIRONMENT=/tmp/venv `
  -e UV_LINK_MODE=copy `
  -w /app `
  ghcr.io/astral-sh/uv:python3.14-bookworm-slim `
  uv run --frozen pytest @args

exit $LASTEXITCODE
