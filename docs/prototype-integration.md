# Floodlight v6: integration plan

Reference: `design/README.md`, `design/docs/conversation-log.md`, `design/docs/build-plan-v1.md`, `design/research/`, and `design/prototype/index.html`. The prototype is a standalone HTML/Three.js demonstration with local sample data. `docs/v6-fidelity-plan.md` now controls the UI milestone: all v6 phone screens and interactions must match the prototype. The release column below describes when real backend behavior ships, not when a screen is built. `docs/plan.md` controls release scope.

## What v6 demonstrates

| Experience | Behavior | Release |
| --- | --- | --- |
| Floodlight | Turf, chalk, ink, tape red for actions, large display numbers, clear responses to actions, optional calm motion. | v1 visual system |
| Tonight in LUMS | Games in kick-off order; scrolling moves the focused card and map camera from ground to ground; Explore map allows free navigation. | v1, using real games |
| Game sheet | Ground, kick-off, visibility, large spots-left count, roster, join/leave, chat, report. Formation and join animation are visual enhancements. | v1 core; embellishments after core works |
| Create and verify | Campus verification; choose sport, known ground, time, capacity, visibility; create a pin. | v1 |
| Your games | Joined and hosted games. Regulars and availability are separate concepts. | Basic list in v1; Regulars and availability in v1.1 |
| Game day and Hostel Cup | Check-in, teams, toss, score, standings, player card. | Phase 2 |
| Second campus | Waitlist and campus expansion. | Phase 3 |
| Places inside places | City → area → block → place, presence and hosted hangouts. Scroll across siblings; zoom into the focused child; breadcrumb goes back up. | Phase 4 |

The time scrubber, detailed 3D scene, weekly repeats, live location, and simulated social activity are references, not v1 deliverables. Pins represent grounds, never people's positions.

## Navigation and data rollout

- Build the complete v6 navigation UI now: scroll across games/blocks/places/hangouts, zoom between place levels, tap breadcrumbs to ascend, and open a game sheet from a card or pin. Use fixtures for screens whose services are scheduled later.
- **Explore map** switches between guided chapters and free map gestures. Returning to the list restores the focused item. A map failure or no-games state must still let someone find or create a game.
- Follow Reduce Motion/Calm: cards and content must remain usable without camera travel or decorative animation. Test scroll-linked camera movement on device. Keep the same visual result as v6 unless the user approves a change.

## Build order on `main`

1. **Build v6 natively.** Follow `docs/v6-fidelity-plan.md`: use React Native for the phone UI and match every v6 screen and interaction against reference captures. The WebView proof was rejected as an implementation; the native MapLibre spike is complete but is not the target UI.
2. **Agree the v1 contract and access rules.** Confirm the LUMS email domain, approved grounds, and which visibility options can ship. Extend `openapi.yaml` for auth/session, verification, games/search, roster, chat, reports, push registration, and consistent errors. Decide identifiers, coordinates `[longitude, latitude]`, UTC timestamps, and spots-left semantics. Do not expose friends/contacts visibility without a defined relationship model.
3. **Make backend data real.** Add a forward-only migration runner with applied-version tracking, then implement Postgres/PostGIS access in Go. Add any needed schema changes as new numbered `*.up.sql` files. Implement verified-campus auth and the nearby-games query with visibility in SQL. Test that an unauthorized account gets no restricted pins before connecting the map.
4. **Build the first live vertical slice.** Feed the matching v6 Tonight, cards, pins, and game sheet from `GET` game data. The card, marker, and sheet must agree on ground, kickoff, roster count, and spots left. Show loading, empty, offline, and map-error states in the same visual language.
5. **Complete the pickup loop.** Connect create, join, and leave. Enforce capacity inside a backend transaction and test concurrent attempts for the last spot. The API response is authoritative; refresh the card, marker, and sheet from it. Add a basic hosted/joined games list.
6. **Add live and trust features.** Authenticate the game WebSocket; update rosters and chat, reconnect after network loss, close user-facing chat at kickoff + 2 hours while retaining moderation records. Add reports, rate limits, and the three planned push events. Test access to restricted games on HTTP and WebSocket paths.
7. **Harden and pilot.** Deploy the API, use self-hosted tiles, test on real devices and poor networks, and run real LUMS games. Use the pilot results before moving v1.1 or Phase 2 features into implementation.

Backend and frontend can work in parallel after step 2: Go implements the contract while Expo builds against contract-shaped fixtures. Replace fixtures endpoint by endpoint; do not let prototype arrays become application state.
