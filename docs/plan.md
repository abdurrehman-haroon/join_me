# Starting build plan


## Agreed scope (2026-10-11)

LUMS first, expanding outwards. No sign-in or campus verification for now; keep a basic profile. Guest sessions are deferred. Always discuss schema first, then frontend mechanics, then implement each feature.

1. **Real map foundation:** MapLibre + OpenFreeMap and areas/places in PostGIS are retained under Explore. The superseded viewport API, old Map screen, clustering, campus recentring and device-location flow were removed on 2026-11-02.
2. **Basic users and events:** minimal users schema and basic profile viewing/name editing implemented without sign-in or schema changes. Reuse users, with sign-in later and no ownership tokens. Approved events/shared status/event_participants database schema implemented, replacing pins/pin_members; optional demo seed available. Read-only event APIs, viewport browsing, type filters, place event lists and participant details are connected. Creation from a selected place is implemented with a demo host, future start time, capacity validation and atomic host participation. Join/leave is implemented with event-row locking, transactional capacity checks, idempotent retries and host-leave protection. Your events and host cancellation are implemented without schema changes.
3. **Pilot essentials:** participant chat, cancellation and kickoff notifications. Host cancellation and participant chat are implemented; notifications are deferred at user request. Reporting is skipped for now; its legacy table is removed by migration 000009. Discuss each schema and frontend flow before implementing.
4. **Real student pilot:** review data, test poor networks and real devices, deploy, and observe whether organised games happen.

All tables require database-managed `created_at` and `updated_at`. New migrations are numbered, forward-only and tracked; applied files are immutable. Fixed-value fields require PostgreSQL enums, never text. The approved geography uses `type`, not `kind`, optional area parent/boundaries, required place points, and event references to places.

Participant messaging is implemented: automatic timestamps, participant-only history/send, cancelled/completed read-only history, cursor pagination, shared WebSocket delivery, drafts and UUID retry. Changes remain uncommitted for review.

Device location (2026-10-13) was removed with the old Map screen on 2026-11-02. No location data was persisted and the app no longer requests location permission.

## Realtime integration (2026-10-15)

Implemented the user-frozen streams/outbox/message-sequence schema, transactional event/chat publication, shared WebSocket server/client, sequence recovery, membership revocation and HTTP long-poll fallback. Event details update roster/count/status in place; chat no longer polls every four seconds. Details and chat share one connection while visible. See realtime.md and handoff.md. Sign-in, map-wide live updates and Your events live subscriptions remain separate work.

## Activity tracking (implemented 2026-10-19)

The approved catalogue is complete: session starts; sport filters, place/event views and empty results; creation/submission outcomes; join attempts/rejections, joins/leaves; host edits/cancellation; chat opens/messages; and pause/resume/close timing. Migration 000011, persistent delivery, strict ingestion and retry-safe transactional outcomes are implemented. Five SQL reports answer discovery, conversion, hosting, coordination and visit questions.

[activities.md](activities.md) is the recording/schema/details contract; [handoff.md](handoff.md) owns verification results and remaining device coverage. Future features must explicitly assess tracking needs per ai.md. Personal statistics are implemented below; production identity, database retention/deletion and broader insights remain decisions.

## Backlog (Join Me #1 discussion, 2026-10-31)

Agreed direction from the product discussion; worked one item at a time in this order. Each item still follows the usual flow: discuss schema, then frontend mechanics, then implement, with a tracking assessment per ai.md. Mark items done here and record verification in handoff.md. Open questions are listed under Next decisions in project.md.

1. **Commit the Lahore hierarchy:** migration 000013, `lahore_catalog.sql`, `design/lahore-skin/` and related changes, after review.
2. **Fixed categories:** backend event `type` is free text, but `EventForm` and the map filter still hardcode football/cricket. Agree a fixed category list (e.g. Sports → Football, Cricket, Padel; Food & Drink → Coffee; Entertainment → Movies) and filter by category instead of free text.
3. **Regional browsing:** replace free zoom with a district list (DHA Phase 1, 2, 3…) → district view listing its places and upcoming events, with category filter and search. Keep the map as a secondary view inside a district. Needs district and district-contents API endpoints in `openapi.yaml`.
4. **Multiple events at one place:** swipe between events at the same place or spot (e.g. several padel time slots), showing each event's creator.
5. **Sign-in and real profiles:** replace the configured `DEMO_USER_ID` with real accounts (sign-in method undecided); profile picture and optional bio. Blocks items 6–9.
6. **Join requests:** joining becomes a request the host accepts or rejects; only accepted users become participants and get the event chat. Track the request lifecycle (requested, accepted, rejected, withdrawn) as activities.
7. **Push notifications:** join requests, accept/reject decisions and event changes; Expo push via the existing outbox/realtime fanout.
8. **Event duration and expiry:** add an end time or duration; mark ended events completed automatically; limit how far ahead events can be scheduled.
9. **Creator trust:** show creator name, photo and events-hosted count on cards first; then attendee ratings after completed events and a creator score.
10. **Privacy:** decide what stays hidden until a request is accepted (e.g. exact spot, exact time, chat).
11. **Later:** optional ID verification (verified tag), business/venue creator profiles, featured events and longer scheduling as paid perks.

Items 7 (notifications), 9 (scoring) and 11 (verification) supersede the matching entries in the deferred list below.

## Deferred

Broader statistics/user-insight proposals remain in [statistics-and-insights.md](statistics-and-insights.md) and require feature-specific discussion before implementation.

## Lahore hierarchy expansion (2026-10-29)

Phase 1 backend foundation is implemented in migration 000013: exactly City -> District -> Place, with optional `place_spots` inside a place but outside navigation. Areas/places have stable slugs and story order; LUMS is a place in DHA Phase 5 and its existing grounds/courts migrate to spots without losing events. Event type is now trimmed free text rather than a fixed catalogue. The Lahore development catalog is in `backend/seeds/lahore_catalog.sql`. Phase 2 backend (2026-11-01) adds the explore API: slug-addressed city districts, district places and place views, a seven-day coming-up window returned as `window_ends_at`, `area_viewed` ingestion and a sample events seed. No schema change was needed. Freshness: fetch on page open/return and pull-to-refresh; no realtime for counts. The Explore tab frontend (2026-11-01) replaces the Map tab: a follow-camera map behind snapping cards for Lahore -> district -> place, right-to-left swipe to open and left-to-right to go back (react-native-gesture-handler), event rows, existing event details/creation with a spot picker, and the free map behind a Map button. Styling (palette, fonts, ripples) is deferred. District outlines are seeded and drawn (see handoff.md); three unconfirmed DHA place locations remain. District geometry remains replaceable catalog data; user-dropped pins (event-owned locations) are deferred for a later schema discussion.

Notifications, Android/physical-device verification, moderation/reporting (unused legacy tables removed by migrations 000009 and 000014), full illustrated-v6 parity, 3D camera choreography, beyond-campus social features, restricted visibility, verification, Regulars, availability/matching, scoring, Hostel Cup, and campus expansion services. The geographic model supports more campuses/places without a LUMS-specific query. Expansion UI and services remain separate milestones.

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

## Joiner goals, milestones and recap (2026-10-19)

Approved implementation: users.event_goal_target (positive nullable integer) and users.event_goal_period (nullable weekly/monthly PostgreSQL enum), both set or both null. Migration 000012 adds the pair without changing existing identities or timestamps. One active goal applies to the current and following periods; PUT /me/event-goal uses the server-owned identity, accepts both fields and can turn the goal off. Goal progress is not persisted.

Your activity now includes a weekly/monthly goal editor (presets plus custom positive target), goal progress, derived first/5/10/25-event and first-sport milestones, and a current-month recap with previous-month comparison and separate hosted count. Existing signup-date history/totals keep their original meaning. New progress/recap use scheduled event dates and current non-host memberships, exclude cancelled/left events and include upcoming events. Hosting recap excludes cancelled events. Rejoining counts once. Leaving/cancellation can remove milestones or progress; rescheduling can move period credit. These are signups, not attendance. Weeks start Monday in the requested device IANA timezone, with local calendar month/week boundaries including DST.

Tracking assessment: no new activities; saved goal settings and existing event/membership data answer these user-facing questions. Freshness: reuse personal-report HTTP refresh on entry, foreground, goal save, returning from event details and explicit Refresh activity. No new socket stream or periodic/background polling for these summary panels; existing host-insight realtime behavior is unchanged. Requests are cancelled on cleanup; save failures preserve the goal draft and retries set the same values safely.

## Future: automatically assigned event goals (2026-10-20)

Plan only; keep the current user-configured goals and implementation unchanged for now. Eventually, goal targets will be assigned by the system instead of entered by users. A weekly/monthly job will use confirmed events actually attended in the previous completed matching period to set the next period's target:

`next_target = max(2, ceil(attended_count * 1.5))`

Examples: 0 attended → 2; 1 → 2; 2 → 3; 3 → 5; 4 → 6. Round upward to a whole event. Calculate from actual attendance, not the previous target or signup count; preserve the existing host/joiner separation for joiner goals.

This depends on implementing reliable attendance confirmation first. Define job timezone/period boundaries, late attendance corrections and safe repeat execution before implementation. Reassess activity recording and goal-update delivery during that feature's planning. The job and attendance-based goal calculation remain future work.
