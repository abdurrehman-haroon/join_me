# Handoff

Updated: 2026-10-11

## Current direction

LUMS first, no sign-in, basic profile, slim pickup flow. Guest sessions deferred. Required order: schema discussion → frontend mechanics → implementation. User approved areas/places with `type`, automatic timestamps on every application table, a real MapLibre map, and OpenFreeMap tiles. Full illustrated-v6 fidelity is deferred; keep the 45-feature inventory for later.

## Implemented

- Go API connected to PostgreSQL/PostGIS, with health, area detail and viewport-place endpoints defined in `openapi.yaml`. pgx/sqlc queries keep geographic filtering in SQL. Read-only; no sessions or game mutations.
- Embedded forward-only migration runner with advisory locking, version/checksum ledger and modified-file rejection. Existing initial migration is unchanged. Migration 000002 adds areas/places and database-owned timestamps across application tables and ledger; 000003 seeds LUMS and six sports places from OpenStreetMap, with source links and ODbL attribution. Migration 000004 explicitly declares the legacy timestamp columns for sqlc model generation without changing applied migrations. Migration 000005 converts areas.type and places.type to PostgreSQL area_type/place_type enums while preserving existing data; sqlc generates typed Go enums. Fixed-value fields must use database enums going forward.
- Native MapLibre/OpenFreeMap map replaces the SVG illustration in the map tab. Campus outline, clustered place markers, optional selected-place outline/details, pan/zoom, campus recentre, and loading/empty/error/retry states. Initial campus/API/style are configurable.
- Other tabs remain labelled sample-data previews. `CampusScene.tsx` is retained but unused by the map tab. No real games, profiles, chat, reports, scoring or push yet.

## Verification and runtime

- `make check` runs Go tests, Expo lint and TypeScript checks. PostGIS integration test also verifies apply-once migrations, timestamp ownership, enum rejection of invalid categories, viewport filtering, response limits and optional area outlines.
- iOS 27 / iPhone 18 Pro native development build succeeded after Expo prebuild applied the MapLibre plugin. Simulator screenshot confirmed actual LUMS tiles, campus outline and clustered markers. OpenFreeMap label fonts use Noto Sans Regular. Further gesture/selection testing is still needed on a physical phone.
- Local PostgreSQL 17/PostGIS runs at 127.0.0.1:5432 (database `joinme`); Go API on 8080; existing Expo Metro on 8081. See `backend/README.md` and `frontend/README.md` for start/reload instructions. The database is manually started, not a login service.

## Next

Review the map, confirm ground names/outlines with LUMS, then discuss the profile/game schema and ownership without sign-in. After agreement, discuss frontend mechanics and implement. Current geo endpoints are public read-only; do not invent guest sessions or mutating ownership rules.

All changes remain uncommitted and unpushed for user review.
