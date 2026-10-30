# One-command local startup for Windows (PowerShell 5.1+ or 7+).
#
#   powershell -ExecutionPolicy Bypass -File .\startup.ps1
#
# Starts the PostGIS database in Docker, builds and starts the API on 8080, loads the
# demo data and starts Metro on 8081 for Expo Go, so the app opens on an iPhone on the
# same network. Native iOS builds need a Mac (see README).
# Keep this window open; press Ctrl+C to stop the API and Metro. The database keeps running.

$ErrorActionPreference = "Stop"
# Windows PowerShell 5.1 sends text to programs as ASCII by default; the seed file is UTF-8.
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ProjectDir = $PSScriptRoot
$RuntimeDir = Join-Path $ProjectDir ".startup.local"
# Compose would otherwise read backend\.env, which may be another developer's shell script.
$ComposeSettings = Join-Path $ProjectDir ".startup.local\compose.env"
New-Item -ItemType Directory -Force -Path (Split-Path $ComposeSettings) | Out-Null
if (-not (Test-Path $ComposeSettings)) { New-Item -ItemType File -Path $ComposeSettings | Out-Null }
$Compose = @("compose", "--env-file", $ComposeSettings, "-f", (Join-Path $ProjectDir "backend\compose.yaml"))
$DatabasePort = if ($env:JOINME_DB_PORT) { $env:JOINME_DB_PORT } else { "5432" }
$env:JOINME_DB_PORT = $DatabasePort
$env:DATABASE_URL = "postgres://joinme:joinme@127.0.0.1:$DatabasePort/joinme?sslmode=disable"
$env:TEST_DATABASE_URL = "postgres://joinme:joinme@127.0.0.1:$DatabasePort/joinme_test?sslmode=disable"
# The iPhone reaches the API and Metro over the local network, so both use this computer's
# LAN address. Without REACT_NATIVE_PACKAGER_HOSTNAME, Expo can pick a Hyper-V/WSL adapter.
# Set JOINME_LAN_ADDRESS when the computer has several networks (for example a VPN).
$LanAddress = $env:JOINME_LAN_ADDRESS
if (-not $LanAddress) {
  $network = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq "Up" } | Select-Object -First 1
  # Offline, the phone cannot connect, but the API and Metro still run on this computer.
  $LanAddress = if ($network) { $network.IPv4Address[0].IPAddress } else { "localhost" }
}
$env:REACT_NATIVE_PACKAGER_HOSTNAME = $LanAddress
$env:EXPO_PUBLIC_API_URL = "http://${LanAddress}:8080"
$started = @()
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

function Test-Url($url) {
  try {
    return (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2).Content
  } catch {
    return $null
  }
}

function Wait-Url($url, $process, $log) {
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    if (Test-Url $url) { return }
    if ($process -and $process.HasExited) {
      Get-Content $log -Tail 40
      throw "A server stopped while starting. See the log above."
    }
    Start-Sleep -Seconds 1
  }
  throw "Timed out waiting for $url"
}

function Start-Logged($file, $arguments, $workingDirectory, $name) {
  $out = Join-Path $RuntimeDir "$name.log"
  $err = Join-Path $RuntimeDir "$name.err.log"
  $options = @{
    FilePath = $file
    WorkingDirectory = $workingDirectory
    RedirectStandardOutput = $out
    RedirectStandardError = $err
    NoNewWindow = $true
    PassThru = $true
  }
  # Start-Process rejects an empty argument list.
  if ($arguments.Count -gt 0) { $options.ArgumentList = $arguments }
  $process = Start-Process @options
  return @{ Process = $process; Log = $out; ErrorLog = $err }
}

try {
  foreach ($command in @("go", "node", "pnpm", "docker")) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
      throw "Missing required command: $command. See README, 'Windows setup'."
    }
  }

  Write-Host "Starting the database (Docker)..."
  docker @Compose up -d --wait db
  if ($LASTEXITCODE -ne 0) {
    throw "Could not start the database. Is Docker Desktop running? If port $DatabasePort is taken (for example by another PostgreSQL), set JOINME_DB_PORT to a free port such as 5433 and run again."
  }
  # The Go tests use a separate database.
  $hasTestDatabase = docker @Compose exec -T db psql -U joinme -d joinme -tAc "SELECT 1 FROM pg_database WHERE datname = 'joinme_test'"
  if ("$hasTestDatabase".Trim() -ne "1") {
    docker @Compose exec -T db psql -U joinme -d joinme -c "CREATE DATABASE joinme_test" | Out-Null
  }
  # The tests apply migrations to an empty database and expect PostGIS to be available.
  docker @Compose exec -T db psql -U joinme -d joinme_test -c "CREATE EXTENSION IF NOT EXISTS postgis" | Out-Null

  if (Test-Url "http://localhost:8080/healthz") {
    Write-Host "Reusing the API already running on port 8080."
  } else {
    Write-Host "Building and starting the API..."
    $apiExe = Join-Path $RuntimeDir "api.exe"
    Push-Location (Join-Path $ProjectDir "backend")
    go build -o $apiExe ./cmd/api
    $buildExit = $LASTEXITCODE
    Pop-Location
    if ($buildExit -ne 0) { throw "The API did not build." }
    $env:PORT = "8080"
    $api = Start-Logged $apiExe @() (Join-Path $ProjectDir "backend") "backend"
    $started += $api.Process
    # The API applies database migrations on startup before it reports healthy.
    Wait-Url "http://localhost:8080/healthz" $api.Process $api.ErrorLog
  }

  # Demo users and events. The seed uses fixed IDs, so running it again changes nothing.
  Get-Content (Join-Path $ProjectDir "backend\seeds\demo.sql") -Raw |
    docker @Compose exec -T db psql -q -U joinme -d joinme --single-transaction -v ON_ERROR_STOP=1 | Out-Null

  # Install every time so a pulled package change (such as an Expo SDK upgrade) is applied;
  # it finishes in about a second when nothing changed.
  $frontend = Join-Path $ProjectDir "frontend"
  Write-Host "Checking app dependencies..."
  Push-Location $frontend
  pnpm install --frozen-lockfile
  $installExit = $LASTEXITCODE
  Pop-Location
  if ($installExit -ne 0) { throw "Could not install the app dependencies. See the output above." }

  if (Test-Url "http://localhost:8081/status") {
    Write-Host "Reusing Metro on port 8081. If it was not started by startup.ps1, stop it and run startup.ps1 again so the app uses ${LanAddress}."
  } else {
    Write-Host "Starting Metro..."
    $metro = Start-Logged "pnpm.cmd" @("exec", "expo", "start", "--go", "--port", "8081") $frontend "frontend"
    $started += $metro.Process
    Wait-Url "http://localhost:8081/status" $metro.Process $metro.ErrorLog
  }

  Write-Host ""
  Write-Host "Open the app on your iPhone (on the same network as this computer):"
  Write-Host "  in Expo Go, tap 'Enter URL manually' and enter exp://${LanAddress}:8081"
  Write-Host ""
  Write-Host "API: http://${LanAddress}:8080 | Metro: http://${LanAddress}:8081"
  Write-Host "Logs are in .startup.local\. Keep this window open; press Ctrl+C to stop."
  while ($true) {
    foreach ($process in $started) {
      if ($process.HasExited) { throw "A development server stopped. Check the logs in .startup.local\ and run startup.ps1 again." }
    }
    Start-Sleep -Seconds 2
  }
} finally {
  # Ctrl+C also lands here. Stop only what this script started; the database keeps running.
  foreach ($process in $started) {
    if (-not $process.HasExited) {
      taskkill /PID $process.Id /T /F | Out-Null
    }
  }
}
