# Starting build plan


## Agreed scope (2026-10-11)

LUMS first, expanding outwards. No sign-in or campus verification for now; keep a basic profile. Guest sessions are deferred. Always discuss schema first, then frontend mechanics, then implement each feature.

1. **Real map foundation:** MapLibre + OpenFreeMap, areas/places in PostGIS, automatic timestamps, viewport API, selection sheets, clustering, recentring, and loading/error states. Implemented; review on device and confirm community-mapped LUMS data.
2. **Basic users and events:** minimal users schema and basic profile viewing/name editing implemented without sign-in or schema changes. Reuse users, with sign-in later and no ownership tokens. Approved events/shared status/event_participants database schema implemented, replacing pins/pin_members; optional demo seed available. Read-only event APIs, viewport browsing, type filters, place event lists and participant details are connected. Creation from a selected place is implemented with a demo host, future start time, capacity validation and atomic host participation. Join/leave is implemented with event-row locking, transactional capacity checks, idempotent retries and host-leave protection. Your events and host cancellation are implemented without schema changes.
3. **Pilot essentials:** participant chat, cancellation and kickoff notifications. Host cancellation and participant chat are implemented; notifications are deferred at user request. Reporting is skipped for now; its legacy table is removed by migration 000009. Discuss each schema and frontend flow before implementing.
4. **Real student pilot:** review data, test poor networks and real devices, deploy, and observe whether organised games happen.

All tables require database-managed `created_at` and `updated_at`. New migrations are numbered, forward-only and tracked; applied files are immutable. Fixed-value fields require PostgreSQL enums, never text. The approved geography uses `type`, not `kind`, optional area parent/boundaries, required place points, and event references to places.

Participant messaging is implemented: automatic timestamps, participant-only history/send, cancelled/completed read-only history, cursor pagination, shared WebSocket delivery, drafts and UUID retry. Changes remain uncommitted for review.

Device location (2026-10-13): approved frontend-only scope implemented with Expo Location, on-tap foreground permission, live dot/accuracy circle, My location recentring, Campus return, denied/services-off/timeout retry states and subscription cleanup. No schema/API change or background tracking. Simulator/device verification is recorded in handoff.md.

## Realtime integration (2026-10-15)

Implemented the user-frozen streams/outbox/message-sequence schema, transactional event/chat publication, shared WebSocket server/client, sequence recovery, membership revocation and HTTP long-poll fallback. Event details update roster/count/status in place; chat no longer polls every four seconds. Details and chat share one connection while visible. See realtime.md and handoff.md. Sign-in, map-wide live updates and Your events live subscriptions remain separate work.

## Activity tracking (implemented 2026-10-19)

The approved catalogue is complete: session starts; sport filters, place/event views and empty results; creation/submission outcomes; join attempts/rejections, joins/leaves; host edits/cancellation; chat opens/messages; and pause/resume/close timing. Migration 000011, persistent delivery, strict ingestion and retry-safe transactional outcomes are implemented. Five SQL reports answer discovery, conversion, hosting, coordination and visit questions.

[activities.md](activities.md) is the recording/schema/details contract; [handoff.md](handoff.md) owns verification results and remaining device coverage. Future features must explicitly assess tracking needs per ai.md. Personal statistics are implemented below; production identity, database retention/deletion and broader insights remain decisions.

## Deferred

Broader statistics/user-insight proposals remain in [statistics-and-insights.md](statistics-and-insights.md) and require feature-specific discussion before implementation.

Notifications, Android/physical-device verification, moderation reporting (legacy table removed), full illustrated-v6 parity, 3D camera choreography, beyond-campus social features, restricted visibility, verification, Regulars, availability/matching, scoring, Hostel Cup, and campus expansion services. The geographic model supports more campuses/places without a LUMS-specific query. Expansion UI and services remain separate milestones.

`feature-inventory.md` preserves all 45 v6 features and dated scope decisions for future prototype comparisons. `v6-fidelity-plan.md` and `prototype-integration.md` preserve earlier design/rollout references; this current scope takes precedence.

Only connected UI ships: Map, Your events and basic You profile. Hostel Cup, fixture game/chat/Game Day/campus sheets, fake player stats and unsupported settings were removed. Prototype references remain in design/.

Local macOS startup: double-click startup.command (runs startup.sh) to start PostgreSQL if needed, backend, Metro and the iPhone 18 Pro / iOS 27 development app. Ctrl+C stops launcher-owned servers; existing servers and PostgreSQL stay running. See README.md.

Host event editing implemented: PATCH /events/{id} accepts title/start/capacity together for the configured demo host, only while scheduled and upcoming. Place/type stay fixed; shared event locking prevents capacity reductions below concurrent membership. Existing DB timestamps remain automatic; no migration. Shared EventForm supports creation/editing with prefilled local time, Save/Cancel, draft retention and request guard. Success refreshes details/map/Your events; closing refreshes uncertain results. Hosting/deployment stays deferred.

## Personal activity (2026-10-19)

Approved user-only scope: You tab → Your activity, with joined/hosted totals, separate left/cancelled counts, sport breakdown, top three grounds and paginated history linking to event details. Month/all-time selection uses the device IANA timezone; first known signup/creation dates define summary cohorts, while history filters each action date. Rejoining counts once and host membership is excluded from joined. Totals include left/cancelled events; these are signups, not attendance.

GET /me/activity derives identity from the server, accepts no user selection and reads existing events/memberships/server-owned activities. Current memberships supply pre-tracking joins; deleted untracked memberships cannot be recovered. No schema or migration change. Existing internal reports are unchanged.

Tracking assessment: reading statistics, changing period and refreshing do not need new activities. Opening history event details reuses event_viewed with the existing profile source, same actor/event/snapshot/timing and retry rules; subsequent detail/chat actions retain their existing sources. No extra personal data enters activity details.

## Host signup insights (2026-10-19)

Approved event-details scope: host-only signup progress, first known signup timing, first recorded capacity milestone and distinct joined/left player counts. GET /events/{id}/signup-insights uses the server-owned demo identity and separate SQL; no schema change or private fields in shared event/realtime payloads. Existing current capacity includes the host; player counts exclude the host. Rejoins count once; left counts players who left at least once even if they rejoin. A recorded leave also proves an earlier signup for legacy events. First signup uses server join history/current membership dates. Capacity milestones distinguish signup, capacity reduction and initially full; current fullness is not invented history. Events without event_created history show an incompleteness note.

The host card refreshes on event sequence changes and realtime recovery, retaining its previous data while the authorized HTTP refresh runs. It reuses the event WebSocket subscription and existing long-poll fallback; no separate stream or periodic poller. Failed refreshes label last-loaded data; only an error-retry action remains; the routine Refresh button is removed. The card stays available for past/cancelled events. Tracking assessment: these derived reads add no activity; existing event view and mutation contracts suffice. Internal SQL reports remain unchanged.
