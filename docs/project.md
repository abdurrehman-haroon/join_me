# Campus Pickup: shared context

## Goal

Help students at LUMS organise pickup football and tape-ball cricket games. The first question is whether games organised in the app actually get played. Expand to other campuses only after the first campus works.

## First release

Current starting scope: LUMS only, basic profile, and no sign-in for now. Build the pickup flow first; see `docs/plan.md` for the updated scope. Discuss schema, then frontend mechanics with the user before implementation. Earlier verification and all-v6 fidelity goals below are deferred for this starting slice.

Campus verification; create and discover game pins; join and leave a capacity-limited roster; live roster and pin chat; reports; three useful notifications. Pins represent grounds, never live user locations.

## Target stack

- `backend/`: Go with chi for HTTP and gorilla/websocket for live updates; pgx/sqlc with PostgreSQL and PostGIS for durable and geographic data; Redis for presence and rate limits when those features arrive.
- `frontend/`: Expo, React Native and TypeScript. Native screens and an SVG campus illustration are being built against the v6 HTML prototype reference. MapLibre is planned for the eventual geographic layer and will be installed when that work starts. The app will call the API over HTTPS and an authenticated WebSocket for live updates.
- FCM for push notifications; Fly.io for API deployment. The database will be managed separately.
- `openapi.yaml`: source of truth for HTTP request and response shapes.
- `backend/migrations/`: numbered, forward-only database schema changes. Applied versions must be tracked; fixes go in a new migration.

These are target choices. The Go health endpoint and native Expo UI exist. An earlier MapLibre sample map was removed because it did not match the v6 design. The current native UI uses sample data and is not connected to the backend.

## Design

Reproduce the phone UI in `design/prototype/index.html` screen by screen, including Floodlight visuals, gestures, movement, and visible interactions. `docs/v6-fidelity-plan.md` defines the parity process. `docs/plan.md` controls the staged release of real services.

## Current state

The Go API serves `GET /healthz`. Expo now opens React Native tabs, game cards, create/details sheets, chat, Game Day, and a profile. The SVG campus scene and several interactions are still approximations of v6, so 1:1 parity is not achieved. All game data is local fixture state. Ground outlines, verified venue coordinates, and hosted tiles are pending. Database tables exist as a migration, but the API does not connect to PostgreSQL yet. No auth, real games, or server chat is implemented.

## Open decisions

- User approved a real geographic map rendered with MapLibre for the starting slice, replacing illustrated-campus parity as the immediate map goal. OpenFreeMap is proposed as the initial tile provider, not explicitly approved. Geographic schema is the next discussion before frontend mechanics and implementation. Guest sessions are deferred; identity ownership remains unresolved.
- Every table must have database-managed `created_at` and `updated_at` timestamps. Set both on insert; automatically update `updated_at` on row updates while preserving `created_at`. Exact migration implementation is pending schema discussion.

- Confirm the approved LUMS email domain and pilot access.
- Exact visibility rules for the first release.
- Deployment accounts and domains.

Use `docs/plan.md` for sequence and `docs/handoff.md` for the latest handoff.

`docs/feature-inventory.md` records the 45-feature v6 baseline with stable IDs for feature discussions and future prototype comparisons.
