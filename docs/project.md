# Campus Pickup: shared context

## Goal

Help students on one Pakistani university campus organise pickup football and tape-ball cricket games. The first question is whether games organised in the app actually get played.

## First release

Campus verification; create and discover game pins; join and leave a capacity-limited roster; live roster and pin chat; reports; three useful notifications. Pins represent grounds, never live user locations.

## Architecture

- `frontend/`: React Native, Expo, TypeScript. Calls the API over HTTPS; later uses an authenticated WebSocket for live updates.
- `backend/`: Go API. PostgreSQL with PostGIS will store users and game data. Redis is deferred until presence or rate limits require it.
- `openapi.yaml`: source of truth for HTTP request and response shapes.
- `backend/migrations/`: database schema changes.

## Current state

The Go API serves `GET /healthz`. The Expo app shows a starter screen and checks that endpoint. Database tables exist as a migration, but the API does not connect to PostgreSQL yet. No auth, games, map, or chat is implemented.

## Open decisions

- First campus and approved campus email domain.
- Exact visibility rules for the first release.
- Deployment accounts and domains.

Use `docs/plan.md` for sequence and `docs/handoff.md` for the latest handoff.
