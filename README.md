# Campus Pickup

One repository for the mobile app and its API.

## Layout

- `frontend/`: Expo mobile app
- `backend/`: Go HTTP API, database migrations, and deployment config
- `openapi.yaml`: shared API contract
- `design/`: Floodlight visual prototype and design research

## Working together

`docs/ai.md` gives both assistants the same workflow. Codex reads `AGENTS.md`; Claude reads `CLAUDE.md`. Both point to that one file. Project context, plan, and handoff live in `docs/`.

From the repo root: `make context` prints the shared context, `make check` runs backend and frontend checks, `make api` starts the API, and `make app` starts Expo. Run `make api` and `make app` in separate terminals.

Both developers work on `main`. Pull before starting, coordinate edits to `openapi.yaml`, and update `docs/handoff.md` with implementation changes. Leave changes uncommitted for review; never push without explicit approval.

## One-click local startup (macOS)

Double-click `startup.command` in Finder. It runs `startup.sh`, starts the existing Homebrew PostgreSQL 17 database if needed, starts/reuses the backend on 8080 and Metro on 8081, and opens Device Hub (Xcode 27) or Simulator (older Xcode) with the iOS app. If the development app is missing, it builds/installs it first. Go, pnpm, Xcode and the existing local joinme/PostGIS database are required. Missing frontend dependencies install from the lockfile.

Keep Terminal open; press Ctrl+C to stop only the servers this launcher started. PostgreSQL and reused servers stay running. Logs are in ignored `.startup.local/`. You can also run `./startup.sh` from a terminal. `DATABASE_URL`, `SIMULATOR_NAME` and `SIMULATOR_RUNTIME` can override local defaults. The launcher explicitly selects iPhone 18 Pro on iOS 27, even if another simulator is booted.

Before opening the app, the launcher fetches the iOS project manifest and compiles its JavaScript bundle. The first bundle may take a minute. It opens the client at `http://127.0.0.1:8081` and reports if a launcher-owned server stops. If the app shows a connection error after closing Terminal, run `startup.command` again and keep its window open.

## Local startup on Windows

Native iOS builds and the iPhone simulator need a Mac. On Windows you can work on all the code, run the API and tests, and open the app on an iPhone with Expo Go (free in the App Store). Expo Go only runs the newest Expo SDK, currently SDK 58, which this app uses. When Expo Go moves on, upgrade the app's SDK or use a development build from the Mac.

Install once:

1. [Git](https://git-scm.com/download/win), [Go 1.23+](https://go.dev/dl/), [Node.js 24 LTS](https://nodejs.org/) and pnpm 12 (`npm install -g pnpm`; if `pnpm --version` still shows an older version from Corepack, also run `corepack install -g pnpm@12`).
2. [Docker Desktop](https://www.docker.com/products/docker-desktop/) for the PostGIS database. Start it before running the scripts.
3. Expo Go on your iPhone. The iPhone and this computer must be on the same network.

Then, from the repo root in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\startup.ps1
```

It starts the database in Docker (`backend/compose.yaml`), builds and starts the API on 8080 (migrations run on startup), loads `backend/seeds/demo.sql` and starts Metro on 8081 for Expo Go, with `EXPO_PUBLIC_API_URL` set to this computer's LAN address. It prints an `exp://<LAN address>:8081` URL: in Expo Go, tap **Enter URL manually** and enter it (Expo Go then lists it under recently opened). If Expo Go is signed in to an Expo account, sign in to the same account on this computer first (`pnpm exec expo login` in `frontend/`), then run `startup.ps1` again. If `expo login` crashes while opening the browser (an Expo CLI bug with `&` in the link on Windows), run `$env:BROWSER = "none"` first and open the printed link yourself. The phone connects to ports 8080 and 8081, so when Windows Firewall asks, allow Node.js and `api.exe` on private networks only, and set your home network to Private in Windows settings: the API has no sign-in yet, so anyone who can reach it acts as the demo user. If the computer has several networks (for example a VPN), set `JOINME_LAN_ADDRESS` to the address the phone can reach. Keep the window open; Ctrl+C stops the API and Metro, and the database keeps running. Set `JOINME_DB_PORT` if port 5432 is taken (for example by another local PostgreSQL).

`.\check.ps1` is the Windows equivalent of `make check`.

Verified on Windows 11 with Windows PowerShell 5.1: `startup.ps1`, `check.ps1`, and the Expo Go manifest and iOS bundle served on the LAN address.

## Run the backend

Install Go 1.23+ and PostgreSQL/PostGIS. See [backend setup](backend/README.md) for the database connection and migration instructions. With `DATABASE_URL` set, `make api` starts the API on port 8080. It serves health, area details, and viewport places.

## Run the mobile app

From `frontend/`, run `pnpm run ios` for a local iOS build and simulator. After that, `pnpm start` starts Metro for JavaScript changes. The map uses MapLibre/OpenFreeMap and database-backed places; Your events, chat and the basic You profile use the API. See `docs/plan.md` for the build sequence.
