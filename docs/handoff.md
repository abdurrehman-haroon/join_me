# Handoff

Updated: 2026-10-11

## Done

- Saved the 45-feature v6 baseline in `docs/feature-inventory.md`, with stable IDs, prototype references, known simulation gaps, and comparison rules for future prototypes. Individual implementation statuses remain unassessed; access discussion is pending.

- One repo with `frontend/` and `backend/`.
- Go health endpoint, initial database migration, and native Expo app with local fixture data.
- Shared API contract currently defines only `GET /healthz`.
- Both assistants use the same workflow in `docs/ai.md`.
- The Floodlight prototype and its research are in `design/`. LUMS is the pilot campus in the design.
- The user rejected the WebView prototype wrapper. `frontend/index.ts` registers native React Native screens from `frontend/src/NativeApp.tsx`. `frontend/src/CampusScene.tsx` draws an initial SVG campus illustration. Tabs, game cards, game/create sheets, chat, Game Day, profile and Hostel Cup are native but fixture-driven. The cleaned native build launches in the iOS 27 simulator. The 3D scene, motion, zoom, screen details and several interactions remain short of 1:1 v6 parity. Unused MapLibre, API helper, fake status bar, Android and web scaffold, and old design exports were removed. Install MapLibre when the geographic layer is implemented. Expo SDK 57 needs `expo-build-properties` with iOS scene support for Xcode 27.
- Database migrations are forward-only. The initial migration exists; no migration runner or applied-version tracking is implemented yet.
- Floodlight v6 design is under `design/`; v1 scope remains in `docs/plan.md`. Work continues directly on `main`.
- `docs/prototype-integration.md` maps v6 screens and navigation to v1 and later phases, with the implementation order.
- The requested UI milestone is now all v6 phone screens and interactions at prototype fidelity. `docs/v6-fidelity-plan.md` defines the on-device renderer proof and parity checks. The MapLibre sample screen is not the target UI.
- The prototype is now a visual reference only; its HTML and WebKit gesture handlers are not bundled into the app.

## Next

Latest direction (2026-10-11): slim down to the LUMS pickup flow with no sign-in and a basic profile. Discuss schema first, then frontend mechanics, then implement. Guest sessions are deferred. Next discuss actual map connection and geographic scalability beyond LUMS. All tables require automatically managed `created_at` and `updated_at`; no schema implementation has been approved. See the current starting scope in `docs/plan.md`; the prior all-v6 parity work below is deferred.

Complete native v6 screen and motion parity, especially the 3D campus and level navigation, then review each screen on simulator and phone. Separate fixtures from rendering and connect the API. Obtain verified coordinates and self-hosted tiles. Confirm LUMS pilot access, email domain, and visibility options; define auth and game endpoints in `openapi.yaml`. Add forward-only migration execution and version tracking.

## Blockers

- Starting-slice map choice is now approved: real map with MapLibre. Geographic schema and frontend mechanics remain pending discussion; OpenFreeMap is only a proposed tile provider.

- LUMS pilot access and email domain are not yet confirmed.
- Self-hosted campus tiles are not configured.

Keep this file factual and short. Replace stale entries after each merged milestone.
