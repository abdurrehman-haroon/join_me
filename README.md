# Campus Pickup

One repository for the mobile app and its API.

## Layout

- `frontend/`: Expo mobile app (to be built)
- `backend/`: Go HTTP API, database migrations, and deployment config
- `openapi.yaml`: shared API contract

## Run the backend

Install Go 1.23+ and Docker. From `backend/`:

```sh
cp .env.example .env
docker compose up -d db
go run ./cmd/api
```

The API listens on `http://localhost:8080`; `GET /healthz` returns JSON. The database container is available for the next backend step. The current API does not connect to it yet.

