# Handoff

Updated: 2026-10-07

## Done

- One repo with `frontend/` and `backend/`.
- Go health endpoint, initial database migration, and Expo starter screen with API health check.
- Shared API contract currently defines only `GET /healthz`.
- Both assistants use the same workflow in `docs/ai.md`.
- The Floodlight prototype and its research are in `design/`. LUMS is the pilot campus in the design.
- MapLibre is configured in Expo with a public temporary style and two sample LUMS pins. TypeScript, lint, and iOS JavaScript bundling pass; native simulator behavior is untested.

## Next

Confirm LUMS pilot access and email domain. Define auth and game endpoints in `openapi.yaml`. Run the MapLibre spike in an Expo development build, check campus tile detail and pin taps, then replace the temporary style with self-hosted tiles.

## Blockers

- LUMS pilot access and email domain are not yet confirmed.
- iOS local build needs a newer Xcode than the installed 16.1; Expo cloud build needs account login.

Keep this file factual and short. Replace stale entries after each merged milestone.
