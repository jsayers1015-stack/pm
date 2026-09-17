# Local dev with hot reload: uvicorn on 8000, next dev on 3000.
# Requires uv and node installed locally. Use scripts/start.ps1 for the Docker path.
Set-Location (Join-Path $PSScriptRoot "..")

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  Write-Host "uv not found. Install it from https://docs.astral.sh/uv/getting-started/installation/"
  Write-Host "Or use scripts/start.ps1 to run in Docker instead."
  exit 1
}

if (-not $env:DB_PATH) {
  $env:DB_PATH = Join-Path $PWD "backend\data\pm.db"
}
New-Item -ItemType Directory -Force -Path (Split-Path $env:DB_PATH) | Out-Null

$backend = Start-Process -PassThru -NoNewWindow -WorkingDirectory (Join-Path $PWD "backend") `
  -FilePath "uv" -ArgumentList "run", "--frozen", "--env-file", "../.env", "uvicorn", "app.main:app", "--reload", "--port", "8000"

try {
  Set-Location (Join-Path $PWD "frontend")
  npm run dev
}
finally {
  if ($backend -and -not $backend.HasExited) { Stop-Process -Id $backend.Id -Force }
}
