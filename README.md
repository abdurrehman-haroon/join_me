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

## Run the backend

Install Go 1.23+. From `backend/`:

```sh
go run ./cmd/api
```

The API listens on `http://localhost:8080`; `GET /healthz` returns JSON. It does not connect to a database yet. When database features are added, install Docker and run `docker compose up -d db` from `backend/`.

## Run the mobile app

From `frontend/`, run `pnpm run ios` for a local iOS build and simulator. After that, `pnpm start` starts Metro for JavaScript changes. The native UI currently uses sample data and does not call the API. See `docs/plan.md` for the build sequence.
