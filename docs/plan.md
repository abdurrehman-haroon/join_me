# First build plan

1. Pick the first campus and its email domain. Agree on visibility rules.
2. Define users, games, rosters, and errors in `openapi.yaml`.
3. Build campus sign-in and verification in the Go API; connect the app.
4. Build pin creation and nearby search using PostGIS. Add visibility tests before exposing pins.
5. Build joining and leaving with capacity enforced in a database transaction.
6. Add live roster and chat, reports, and three push notifications.
7. Test real games on campus, then prepare deployment and store builds.

The app currently has a launch screen and API health check. Game data is not implemented yet.
