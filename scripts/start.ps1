# Start the app in Docker. Windows.
# Native command failures are detected via $LASTEXITCODE; ErrorActionPreference
# is deliberately not "Stop", because docker writes progress to stderr.
Set-Location (Join-Path $PSScriptRoot "..")

docker compose up --build -d
if ($LASTEXITCODE -ne 0) {
  Write-Host "docker compose failed with exit code $LASTEXITCODE"
  exit $LASTEXITCODE
}

Write-Host "Running at http://localhost:8000"
