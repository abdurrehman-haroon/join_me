# First build plan

## Current agreed starting scope (2026-10-11)

Start with LUMS only and no campus sign-in or email verification. Keep a basic profile; build browse/filter games, details, create, join/leave, and Your games first, followed by host cancellation, participant chat, reports, and cancellation/kickoff notifications before a real student pilot. Defer 3D/motion parity, beyond-campus features, restricted visibility, Regulars, matching, scoring, and Cup features for this first working slice. This supersedes the earlier all-v6 UI milestone as the immediate implementation priority; preserve the full inventory for later.

Required workflow for each feature: discuss the schema with the user first, then frontend mechanics, then implement. No schema or frontend mechanics have been approved for this new slice yet. Guest sessions are deferred. Discuss the actual map provider connection and geographic expansion model next. Every table must have automatically managed `created_at` and `updated_at`; migration details remain pending.

## Earlier rollout reference

Map decision (2026-10-11): use a real geographic map with MapLibre. Discuss the areas/places schema next; then discuss frontend mechanics before implementation. Initial tile provider remains proposed.

Use `docs/feature-inventory.md` to track feature discussions and compare future prototypes against the v6 baseline. The inventory does not change release scope.

See `docs/v6-fidelity-plan.md` for the current UI milestone: all v6 screens and interactions, matched to the prototype. The list below remains the staged release plan for real services. Do not treat fixture-driven UI as a shipped feature.

1. Confirm LUMS pilot access, the email domain, and visibility rules. Run the manual WhatsApp game pilot described in `design/docs/build-plan-v1.md`.
2. Define users, games, rosters, and errors in `openapi.yaml` so backend and frontend can work in parallel.
3. Set up forward-only migration execution and applied-version tracking. Build campus sign-in and verification in Go; connect the Expo app.
4. Finish native v6 Tonight, game cards, and game sheet parity, then connect real game data. Several v6 place levels and screens are still missing from the native app; real beyond-campus services remain in their rollout phase.
5. Build pin creation and nearby search with PostGIS. Put visibility in SQL and pass the visibility tests before exposing pins.
6. Build join and leave with capacity enforced in a database transaction, then live roster, chat, reports, and three push notifications.
7. Deploy the API, test real games at LUMS, then prepare store builds.

Keep the first release focused on finding and filling games. The prototype's time scrubber, weekly repeats, game-day scoring, Hostel Cup, player cards, and extra 3D moments are design references for later phases unless separately approved for v1.
