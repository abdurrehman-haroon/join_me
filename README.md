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

Each developer works on a short feature branch, pulls `main` before starting, and opens a pull request. Agree on `openapi.yaml` changes before implementing both sides. Update the handoff file in the pull request so the next person has the current state.

## Run the backend

Install Go 1.23+. From `backend/`:

```sh
go run ./cmd/api
```

The API listens on `http://localhost:8080`; `GET /healthz` returns JSON. It does not connect to a database yet. When database features are added, install Docker and run `docker compose up -d db` from `backend/`.

## Run the mobile app

From `frontend/`, run `pnpm start`. The default API URL is `http://localhost:8080`. For a physical phone, copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL` to your computer's LAN address. The starter screen checks the API connection. See `docs/plan.md` for the build sequence.
