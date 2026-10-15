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

## Run the backend

Install Go 1.23+ and PostgreSQL/PostGIS. See [backend setup](backend/README.md) for the database connection and migration instructions. With `DATABASE_URL` set, `make api` starts the API on port 8080. It serves health, area details, and viewport places.

## Run the mobile app

From `frontend/`, run `pnpm run ios` for a local iOS build and simulator. After that, `pnpm start` starts Metro for JavaScript changes. The map uses MapLibre/OpenFreeMap and database-backed places; Your events, chat and the basic You profile use the API. See `docs/plan.md` for the build sequence.
