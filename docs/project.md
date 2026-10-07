# Campus Pickup: shared context

## Goal

Help students at LUMS organise pickup football and tape-ball cricket games. The first question is whether games organised in the app actually get played. Expand to other campuses only after the first campus works.

## First release

Campus verification; create and discover game pins; join and leave a capacity-limited roster; live roster and pin chat; reports; three useful notifications. Pins represent grounds, never live user locations.

## Target stack

- `backend/`: Go with chi for HTTP and gorilla/websocket for live updates; pgx/sqlc with PostgreSQL and PostGIS for durable and geographic data; Redis for presence and rate limits when those features arrive.
- `frontend/`: React Native, Expo, and TypeScript. MapLibre with self-hosted map tiles. Calls the API over HTTPS and an authenticated WebSocket for live updates. MapLibre requires an Expo development build.
- FCM for push notifications; Fly.io for API deployment. The database will be managed separately.
- `openapi.yaml`: source of truth for HTTP request and response shapes.
- `backend/migrations/`: database schema changes.

These are target choices. Only the Go health endpoint and Expo starter are implemented so far.

## Design

Use the Floodlight direction in `design/README.md` and the interactive reference in `design/prototype/index.html`: turf, chalk, ink, restrained tape red, and a prominent spots-left count. The prototype is HTML/three.js reference material, not React Native code. `docs/plan.md` controls what ships in v1.

## Current state

The Go API serves `GET /healthz`. The Expo app shows a starter screen and checks that endpoint. Database tables exist as a migration, but the API does not connect to PostgreSQL yet. No auth, games, map, or chat is implemented.

## Open decisions

- Confirm the approved LUMS email domain and pilot access.
- Exact visibility rules for the first release.
- Deployment accounts and domains.

Use `docs/plan.md` for sequence and `docs/handoff.md` for the latest handoff.
