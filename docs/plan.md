# Starting build plan

## Agreed scope (2026-10-11)

LUMS first, expanding outwards. No sign-in or campus verification for now; keep a basic profile. Guest sessions are deferred. Always discuss schema first, then frontend mechanics, then implement each feature.

1. **Real map foundation:** MapLibre + OpenFreeMap, areas/places in PostGIS, automatic timestamps, viewport API, selection sheets, clustering, recentring, and loading/error states. Implemented; review on device and confirm community-mapped LUMS data.
2. **Basic users and events:** minimal users schema and basic profile viewing/name editing implemented without sign-in or schema changes. Reuse users, with sign-in later and no ownership tokens. Approved events/shared status/event_participants database schema implemented, replacing pins/pin_members; optional demo seed available. Read-only event APIs, viewport browsing, type filters, place event lists and participant details are connected. Creation from a selected place is implemented with a demo host, future start time, capacity validation and atomic host participation. Join/leave is implemented with event-row locking, transactional capacity checks, idempotent retries and host-leave protection. Your events and host cancellation are implemented without schema changes.
3. **Pilot essentials:** participant chat, cancellation and kickoff notifications. Host cancellation and participant chat are implemented; notifications are deferred at user request. Reporting is skipped for now; its legacy table is removed by migration 000009. Discuss each schema and frontend flow before implementing.
4. **Real student pilot:** review data, test poor networks and real devices, deploy, and observe whether organised games happen.

All tables require database-managed `created_at` and `updated_at`. New migrations are numbered, forward-only and tracked; applied files are immutable. Fixed-value fields require PostgreSQL enums, never text. The approved geography uses `type`, not `kind`, optional area parent/boundaries, required place points, and event references to places.

Participant messaging is implemented: automatic timestamps, participant-only history/send, cancelled/completed read-only history, cursor pagination, foreground polling, drafts and UUID retry. Changes remain uncommitted for review.

## Deferred

Notifications, end-to-end test work (skipped at user request), reporting (legacy table removed), full illustrated-v6 parity, 3D camera choreography, beyond-campus social features, restricted visibility, verification, Regulars, availability/matching, scoring, Hostel Cup, and campus expansion services. The geographic model supports more campuses/places without a LUMS-specific query. Expansion UI and services remain separate milestones.

`feature-inventory.md` preserves all 45 v6 features and dated scope decisions for future prototype comparisons. `v6-fidelity-plan.md` and `prototype-integration.md` preserve earlier design/rollout references; this current scope takes precedence.

Only connected UI ships: Map, Your events and basic You profile. Hostel Cup, fixture game/chat/Game Day/campus sheets, fake player stats and unsupported settings were removed. Prototype references remain in design/.
