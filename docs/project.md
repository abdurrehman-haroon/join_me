# Campus Pickup: shared context

## Goal and starting scope

Help students at LUMS organise pickup football and tape-ball cricket games, then expand outwards. Start without sign-in or campus verification, with a basic profile and the slim pickup flow in `plan.md`. Guest sessions are deferred; ownership for future game mutations remains undecided.

For each feature, discuss schema with the user, then frontend mechanics, then implement. Work on `main`, uncommitted and unpushed.

## Agreed map direction

Use a real geographic map with MapLibre and OpenFreeMap tiles. This supersedes the immediate illustrated-v6 fidelity milestone. Preserve Floodlight colors/type and keep sample-data previews distinct from connected features. Full prototype coverage remains in `feature-inventory.md`; fidelity references remain in `v6-fidelity-plan.md`.

The map opens at LUMS, pans/zooms freely, loads viewport places after movement settles, clusters nearby points, opens a place-details sheet and outline on selection, and recentres on the initial campus. Empty/loading/error/retry states are required. Games follow separately.

## Stack and data rules

- Go HTTP API, pgx/sqlc, PostgreSQL/PostGIS. Existing `net/http` routing is retained for this small read-only slice; chi/WebSocket, Redis and FCM remain target choices when needed.
- Expo SDK 57, React Native, TypeScript, native MapLibre. OpenFreeMap serves background tiles directly; our API serves our places.
- `openapi.yaml` defines the HTTP contract.
- Numbered forward-only migrations run once, with checksums and applied-version tracking. Never modify applied files.
- Every application table has database-owned `created_at` and `updated_at`. Inserts set both; updates preserve creation time and refresh update time. PostGIS extension metadata is excluded.
- `areas`: optional parent, name, `type` as the PostgreSQL `area_type` enum (city/district/campus), optional boundary.
- `places`: area, name, `type` as the PostgreSQL `place_type` enum (ground/court/cafe/park), required WGS84 point, optional boundary. Games will reference places when their schema is agreed.

## Current state

The API connects to PostGIS and serves health, area details, and bounded viewport places. New migrations add geography and timestamp management to existing tables, plus community-mapped LUMS data from OpenStreetMap. Native MapLibre loads OpenFreeMap Liberty tiles and displays the campus and sports places. Initial data is not campus-verified. Other tabs remain fixture previews; no real games, auth, profiles, chat, reports or push is implemented.

## Next decisions

Review map behavior and confirm campus names/locations. Discuss the games/profile ownership schema, then frontend mechanics. Confirm pilot access before a student rollout. Deployment accounts/domains and future verified-access rules remain undecided.

See `plan.md` for scope, `handoff.md` for verification and runtime details, and `feature-inventory.md` for the stable 45-feature v6 baseline.
