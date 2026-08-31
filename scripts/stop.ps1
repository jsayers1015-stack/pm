# Stop the app. Pass --volumes to also delete the database.
Set-Location (Join-Path $PSScriptRoot "..")

docker compose down @args
if ($LASTEXITCODE -ne 0) {
  Write-Host "docker compose down failed with exit code $LASTEXITCODE"
  exit $LASTEXITCODE
}

Write-Host "Stopped"
