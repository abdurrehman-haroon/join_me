#!/bin/bash
set -euo pipefail

# Finder does not always inherit Homebrew's PATH.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="$PROJECT_DIR/.startup.local"
POSTGRES_BIN="/opt/homebrew/opt/postgresql@17/bin"
SIMULATOR_NAME="${SIMULATOR_NAME:-iPhone 18 Pro}"
SIMULATOR_RUNTIME="${SIMULATOR_RUNTIME:-com.apple.CoreSimulator.SimRuntime.iOS-27-0}"
export DATABASE_URL="${DATABASE_URL:-postgres://$(id -un)@127.0.0.1:5432/joinme?sslmode=disable}"
export EXPO_PUBLIC_API_URL="http://localhost:8080"
api_pid=""
metro_pid=""
log_pid=""
mkdir -p "$RUNTIME_DIR"

stop_process_tree() {
  local child_pid
  for child_pid in $(pgrep -P "$1" || true); do
    stop_process_tree "$child_pid"
  done
  kill "$1" 2>/dev/null || true
}

cleanup() {
  trap - EXIT INT TERM HUP
  for server_pid in "$log_pid" "$metro_pid" "$api_pid"; do
    if [[ -n "$server_pid" ]]; then
      stop_process_tree "$server_pid"
    fi
  done
  rm -f "$RUNTIME_DIR/launcher.pid"
  rmdir "$RUNTIME_DIR/lock" 2>/dev/null || true
}

if ! mkdir "$RUNTIME_DIR/lock" 2>/dev/null; then
  previous_pid="$(cat "$RUNTIME_DIR/launcher.pid" 2>/dev/null || true)"
  if [[ "$previous_pid" =~ ^[0-9]+$ ]] && kill -0 "$previous_pid" 2>/dev/null; then
    echo "The launcher is already running. Use its Terminal window."
    exit 0
  fi
  rmdir "$RUNTIME_DIR/lock"
  mkdir "$RUNTIME_DIR/lock"
fi
printf '%s\n' "$$" > "$RUNTIME_DIR/launcher.pid"
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

for command_name in go pnpm curl xcrun python3; do
  if ! command -v "$command_name" >/dev/null; then
    echo "Missing required command: $command_name"
    exit 1
  fi
done

if ! "$POSTGRES_BIN/pg_isready" -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
  echo "Starting PostgreSQL…"
  "$POSTGRES_BIN/pg_ctl" -D /opt/homebrew/var/postgresql@17 \
    -l "$RUNTIME_DIR/postgres.log" -o '-h 127.0.0.1 -p 5432' start
fi
# Check the existing database before starting API migrations.
"$POSTGRES_BIN/psql" "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc 'SELECT 1' >/dev/null

if lsof -tiTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
  if [[ "$(curl -fsS --max-time 3 http://localhost:8080/healthz)" != '{"status":"ok"}' ]]; then
    echo "Port 8080 is occupied by another service. Stop it and try again."
    exit 1
  fi
  echo "Reusing backend on port 8080."
else
  echo "Building and starting backend…"
  (cd "$PROJECT_DIR/backend" && go build -o "$RUNTIME_DIR/api" ./cmd/api)
  (cd "$PROJECT_DIR/backend" && PORT=8080 exec "$RUNTIME_DIR/api") > "$RUNTIME_DIR/backend.log" 2>&1 &
  api_pid=$!
  for attempt in {1..60}; do
    if curl -fsS --max-time 1 http://localhost:8080/healthz >/dev/null 2>&1; then break; fi
    if ! kill -0 "$api_pid" 2>/dev/null; then cat "$RUNTIME_DIR/backend.log"; exit 1; fi
    sleep 1
  done
  curl -fsS --max-time 3 http://localhost:8080/healthz >/dev/null
fi

cd "$PROJECT_DIR/frontend"
# Install every time so a pulled package change (such as an Expo SDK upgrade) is applied.
pnpm install --frozen-lockfile
simulator_info="$(xcrun simctl list devices available -j | python3 -c '
import json, sys
runtime, name = sys.argv[1:]
for device in json.load(sys.stdin)["devices"].get(runtime, []):
    if device["name"] == name:
        print(device["udid"] + "|" + device["state"])
        break
else:
    sys.exit("Requested simulator is not installed: " + name + " (" + runtime + ")")
' "$SIMULATOR_RUNTIME" "$SIMULATOR_NAME")"
IFS='|' read -r simulator_id simulator_state <<< "$simulator_info"
echo "Using $SIMULATOR_NAME on $SIMULATOR_RUNTIME ($simulator_id)."
if [[ "$simulator_state" != "Booted" ]]; then
  xcrun simctl boot "$simulator_id"
fi
xcrun simctl bootstatus "$simulator_id" -b
developer_directory="$(xcode-select -p)"
device_hub="$(dirname "$developer_directory")/Applications/DeviceHub.app"
if [[ -d "$device_hub" ]]; then
  open -a "$device_hub"
elif ! open -a Simulator --args -CurrentDeviceUDID "$simulator_id"; then
  echo "Could not open Device Hub or Simulator. Check the active Xcode installation."
  exit 1
fi

if lsof -tiTCP:8081 -sTCP:LISTEN >/dev/null 2>&1; then
  if [[ "$(curl -fsS --max-time 3 http://127.0.0.1:8081/status)" != 'packager-status:running' ]]; then
    echo "Metro must be reachable on 127.0.0.1:8081. Stop the existing Metro and restart this launcher."
    exit 1
  fi
  echo "Reusing Metro on port 8081."
else
  echo "Starting frontend…"
  # iOS resolves its bundle URL to IPv4; avoid Node binding localhost to IPv6 only.
  (export NODE_OPTIONS="${NODE_OPTIONS:-} --dns-result-order=ipv4first"; exec pnpm exec expo start --dev-client --localhost --port 8081) > "$RUNTIME_DIR/frontend.log" 2>&1 &
  metro_pid=$!
  for attempt in {1..60}; do
    if curl -fsS --max-time 1 http://127.0.0.1:8081/status >/dev/null 2>&1; then break; fi
    if ! kill -0 "$metro_pid" 2>/dev/null; then cat "$RUNTIME_DIR/frontend.log"; exit 1; fi
    sleep 1
  done
  curl -fsS --max-time 3 http://127.0.0.1:8081/status >/dev/null
fi

# Metro's status endpoint can respond before the project can actually load.
# Fetch the iOS manifest and compile its bundle before opening the native client.
echo "Preparing the iOS project (the first bundle may take a minute)…"
curl -fsS --max-time 30 -H 'Expo-Platform: ios' \
  http://127.0.0.1:8081/ -o "$RUNTIME_DIR/metro-manifest.json"
bundle_url="$(python3 -c '
import json, sys
from urllib.parse import urlsplit
manifest = json.load(open(sys.argv[1]))
url = manifest["launchAsset"]["url"]
parts = urlsplit(url)
if parts.scheme != "http" or parts.hostname not in ("localhost", "127.0.0.1") or parts.port != 8081:
    sys.exit("Metro returned a non-local bundle URL. Stop it and restart this launcher.")
print(url)
' "$RUNTIME_DIR/metro-manifest.json")"
curl -fsS --max-time 180 "$bundle_url" -o /dev/null

if ! xcrun simctl get_app_container "$simulator_id" com.abdrhsteam.campuspickup app >/dev/null 2>&1; then
  echo "Installing the iOS development build (first run may take a few minutes)…"
  pnpm exec expo run:ios --no-bundler --device "$simulator_id" --port 8081
fi
xcrun simctl openurl "$simulator_id" 'exp+campus-pickup://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081'
echo "Backend: http://localhost:8080 | Metro: http://localhost:8081"
echo "Keep this window open. Press Ctrl+C to stop servers started here. PostgreSQL stays running."
touch "$RUNTIME_DIR/backend.log" "$RUNTIME_DIR/frontend.log"
tail -n 5 -f "$RUNTIME_DIR/backend.log" "$RUNTIME_DIR/frontend.log" &
log_pid=$!
while kill -0 "$log_pid" 2>/dev/null; do
  for server_pid in "$api_pid" "$metro_pid"; do
    if [[ -n "$server_pid" ]] && ! kill -0 "$server_pid" 2>/dev/null; then
      echo "A development server stopped. Check the logs above and run startup.command again."
      exit 1
    fi
  done
  sleep 2
done
wait "$log_pid"
