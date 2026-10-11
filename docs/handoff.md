# Handoff

Updated: 2026-10-11

## Done

- One repo with `frontend/` and `backend/`.
- Go health endpoint, initial database migration, and Expo starter screen with API health check.
- Shared API contract currently defines only `GET /healthz`.
- Both assistants use the same workflow in `docs/ai.md`.
- The Floodlight prototype and its research are in `design/`. LUMS is the pilot campus in the design.
- MapLibre is configured in Expo with a public temporary style and two sample LUMS pins. TypeScript, lint, and iOS JavaScript bundling pass; native simulator behavior is untested.
- Database migrations are forward-only. The initial migration exists; no migration runner or applied-version tracking is implemented yet.
- Floodlight v6 design is under `design/`; v1 scope remains in `docs/plan.md`. Work continues directly on `main`.

## Next

Confirm LUMS pilot access and email domain. Define auth and game endpoints in `openapi.yaml`. Add forward-only migration execution and version tracking. Verify the MapLibre spike in a local Expo development build, then replace the temporary style with self-hosted tiles.

## Blockers

- LUMS pilot access and email domain are not yet confirmed.
- Local iOS build with the updated Xcode has not yet been verified.

Keep this file factual and short. Replace stale entries after each merged milestone.
