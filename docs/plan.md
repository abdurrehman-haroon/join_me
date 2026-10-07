# First build plan

1. Confirm LUMS pilot access, the email domain, and visibility rules. Run the manual WhatsApp game pilot described in `design/docs/build-plan-v1.md`.
2. Define users, games, rosters, and errors in `openapi.yaml` so backend and frontend can work in parallel.
3. Build campus sign-in and verification in Go; connect the Expo app.
4. Prove MapLibre works in an Expo development build with campus tiles. The sample map and pins are scaffolded; native testing and self-hosted campus tiles remain. Build the Floodlight game sheet and keep the spots-left count prominent.
5. Build pin creation and nearby search with PostGIS. Put visibility in SQL and pass the visibility tests before exposing pins.
6. Build join and leave with capacity enforced in a database transaction, then live roster, chat, reports, and three push notifications.
7. Deploy the API, test real games at LUMS, then prepare store builds.

Keep the first release focused on finding and filling games. The prototype's time scrubber, weekly repeats, game-day scoring, Hostel Cup, player cards, and extra 3D moments are design references for later phases unless separately approved for v1.
