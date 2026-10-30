# Windows equivalent of `make check`: backend tests, then frontend lint, types and tests.
#
#   powershell -ExecutionPolicy Bypass -File .\check.ps1
#
# Needs the Docker database from startup.ps1 (it does not have to be running already;
# this starts it).

$ErrorActionPreference = "Stop"
$ProjectDir = $PSScriptRoot
$DatabasePort = if ($env:JOINME_DB_PORT) { $env:JOINME_DB_PORT } else { "5432" }
$env:JOINME_DB_PORT = $DatabasePort
$env:DATABASE_URL = "postgres://joinme:joinme@127.0.0.1:$DatabasePort/joinme?sslmode=disable"
$env:TEST_DATABASE_URL = "postgres://joinme:joinme@127.0.0.1:$DatabasePort/joinme_test?sslmode=disable"
# Compose would otherwise read backend\.env, which may be another developer's shell script.
$ComposeSettings = Join-Path $ProjectDir ".startup.local\compose.env"
New-Item -ItemType Directory -Force -Path (Split-Path $ComposeSettings) | Out-Null
if (-not (Test-Path $ComposeSettings)) { New-Item -ItemType File -Path $ComposeSettings | Out-Null }
$Compose = @("compose", "--env-file", $ComposeSettings, "-f", (Join-Path $ProjectDir "backend\compose.yaml"))

function Invoke-Step($directory, $file, $arguments) {
  Push-Location $directory
  & $file @arguments
  $exit = $LASTEXITCODE
  Pop-Location
  if ($exit -ne 0) { throw "Failed: $file $($arguments -join ' ')" }
}

docker @Compose up -d --wait db
if ($LASTEXITCODE -ne 0) {
  throw "Could not start the database. Is Docker Desktop running? If port $DatabasePort is taken (for example by another PostgreSQL), set JOINME_DB_PORT to a free port such as 5433 and run again."
}
$hasTestDatabase = docker @Compose exec -T db psql -U joinme -d joinme -tAc "SELECT 1 FROM pg_database WHERE datname = 'joinme_test'"
if ("$hasTestDatabase".Trim() -ne "1") {
  docker @Compose exec -T db psql -U joinme -d joinme -c "CREATE DATABASE joinme_test" | Out-Null
}
# The tests apply migrations to an empty database and expect PostGIS to be available.
docker @Compose exec -T db psql -U joinme -d joinme_test -c "CREATE EXTENSION IF NOT EXISTS postgis" | Out-Null

$backend = Join-Path $ProjectDir "backend"
$frontend = Join-Path $ProjectDir "frontend"
Invoke-Step $backend "go" @("test", "./...")
Invoke-Step $frontend "pnpm" @("exec", "expo", "lint", "index.ts", "src")
Invoke-Step $frontend "pnpm" @("exec", "tsc", "--noEmit")
Invoke-Step $frontend "pnpm" @("run", "test:realtime")
Invoke-Step $frontend "pnpm" @("run", "test:activities")
Write-Host "All checks passed."
