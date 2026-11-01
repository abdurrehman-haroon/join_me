# Campus Pickup API

Requires Go 1.23+, PostgreSQL with PostGIS, and `DATABASE_URL`.

## Local database

With Docker available, from this directory:

```sh
docker compose up -d db
export DATABASE_URL='postgres://joinme:joinme@127.0.0.1:5432/joinme?sslmode=disable'
go run ./cmd/api
```

For an existing local PostgreSQL/PostGIS installation, create a dedicated `joinme` database and set `DATABASE_URL` to its connection string instead. The development setup used on this machine is PostgreSQL 17 on `127.0.0.1:5432`, database `joinme`, local role `abdurrehman`, with no password. It was started with `pg_ctl`, not registered as a login service:

```sh
/opt/homebrew/opt/postgresql@17/bin/pg_ctl -D /opt/homebrew/var/postgresql@17 -l /tmp/joinme-postgres.log -o '-h 127.0.0.1 -p 5432' start
export DATABASE_URL='postgres://abdurrehman@127.0.0.1:5432/joinme?sslmode=disable'
go run ./cmd/api
```

The API defaults to port 8080. Startup applies embedded forward-only migrations, serialized with a database advisory lock. Each version and SHA-256 checksum is recorded in `schema_migrations`; changed applied files are rejected. An existing database with manually applied, untracked tables needs its history reconciled before using this runner; it is not silently baselined.

## Health

- `GET /healthz`

The public Explore endpoints below provide geography and upcoming events. No identity/session or verification is implemented. Event creation uses a temporary demo host. MapLibre loads background tiles directly from OpenFreeMap.

## Event details

- `GET /events/{uuid}`: event with host, place, shared status, participants, count, available spots and fullness. Cancelled, completed and elapsed events remain accessible by ID. Missing UUID returns 404; malformed UUID/bounds/type returns 400.

This endpoint is public read-only and specified in `../openapi.yaml`. Participant counts include the host. Event creation is described below; no identity endpoints are exposed.

## Explore endpoints

Public read-only feed for the City -> District -> Place pages, addressed by slugs:

- `GET /cities/{city}/districts`: districts ordered by sort_order, each with `bbox` (outline or places extent), `place_count`, `upcoming_event_count` and `first_up` (earliest coming-up event and its place, or null).
- `GET /cities/{city}/districts/{district}/places`: places ordered by sort_order, each with coordinates, exact `upcoming_event_count` and at most 20 event summaries.
- `GET /cities/{city}/districts/{district}/places/{place}`: place with district/city references, its spots and at most 100 event summaries (`truncated` when more exist).

"Coming up" means scheduled events starting within the next seven days (`exploreWindow` in `internal/geography`); every response returns `window_ends_at`. Unknown slugs, or a district/place under the wrong parent, return 404; malformed slugs return 400.

## Event creation

`POST /events` accepts `{place_id,spot_id?,title,type,starts_at,capacity}`. Title is trimmed to 1–200 characters and the user-entered type to 1–50 characters. A supplied spot must belong to the selected place. Start is a future RFC3339 timestamp and capacity is a positive int32 including the host. The server assigns status/host and creates host membership atomically.

`DEMO_USER_ID` defaults to `20000000-0000-4000-8000-000000000001` (Demo Ali). Load `seeds/demo.sql` before creating events, or configure an existing user ID. Missing demo user or scheduled status returns 503. The request cannot choose a host or status. This is temporary shared demo identity until sign-in is implemented. Optional X-Activity-ID, X-Activity-Session and X-Activity-Interaction UUID headers are required together. Reuse them and the original body to confirm the same creation after uncertainty: concurrent identical deliveries return the original 201/id, while changed reuse returns 409. Without headers creation remains non-idempotent; check the event list before resubmitting. Do not automatically replay business requests from the activity queue.

## Joining and leaving

`PUT /events/{id}/participation` joins as `DEMO_USER_ID`. `DELETE` on the same path leaves. Neither accepts a user ID or needs a body. Both lock the event row in a READ COMMITTED transaction; membership/count queries run after acquiring the lock so concurrent joins see committed changes. Capacity includes the host. Already joined (even if now full/closed) and already absent return 204 without changing membership. New joins require scheduled status, a future start and available capacity. Full/closed or host-leave attempts return 409; missing event 404; unavailable demo user 503. Non-host participants may leave regardless of event status/time. Hosts remain participants when their event is cancelled.

Event details include `viewer: {id,is_host,is_participant}` for the configured demo user. The mobile UI uses these flags and refreshes details/counts after participation attempts. Future participant/capacity/status mutation endpoints must use the same event lock. Direct SQL writes bypass these service-level capacity rules.

## Schema and initial data

`areas` supports optional parents and boundaries; `places` references an area and requires a WGS84 point. Both use `type`, backed by PostgreSQL `area_type` and `place_type` enums (migration 000005). Fixed-value fields must use database enums rather than text. All application tables and the migration ledger have database-owned `created_at` and `updated_at`; inserts set both, updates preserve creation time and refresh update time. The PostGIS extension's own metadata tables are not modified. Migration 000004 declares the legacy timestamp columns explicitly for sqlc, since its parser cannot infer the dynamic alterations in 000002.

Migration 000006 simplifies `users` to a generated UUID, required nonblank `display_name`, and automatic timestamps. Email, campus and verification fields are removed; existing user IDs/references are retained with placeholder display name `User`. Profile endpoints and frontend are deferred.

Migration 000013 converts geography to City -> District -> Place, makes LUMS a place in DHA Phase 5, and migrates its six community-mapped sports locations to `place_spots`. It also adds stable slugs/order and optional event spots. `seeds/lahore_catalog.sql` loads the replaceable Lahore development catalog: 13 districts, 26 places (17 at OpenStreetMap locations with footprints) and illustrative district outlines built from the places plus OSM outlines where available (ODbL). Optional `seeds/lahore_sample_events.sql` (after the catalog and demo seeds) adds 40 fictional events across the catalog; rerunning it moves them back into the coming week.

Lahore area ID is `00000000-0000-4000-8000-000000000101`; DHA Phase 5 is `00000000-0000-4000-8000-000000000102`; LUMS place is `00000000-0000-4000-8000-000000000100`.

## Events and optional demo data

Migration 000007 introduced events and shared statuses. Migration 000013 converts the former football/cricket enum to trimmed free text so users may enter any event type. All application tables retain database-managed timestamps.

Legacy pins retain IDs, hosts and participants. Their locations become places under an existing campus with the matching legacy campus name, or a new campus area; expired pins become completed. Legacy visibility and expiry fields are removed under the approved minimal schema. The local legacy tables were empty.

The generated `CreateEvent` query adds the host as a participant in the same SQL statement. Capacity includes the host. Direct SQL inserts must supply host membership themselves. Duplicate participation is rejected by the composite primary key. Join/leave HTTP endpoints enforce capacity under an event-row lock. Status-type validation as more model types are added remains for a later slice.

After starting the API to apply migrations, load optional development data from this directory:

```sh
psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f seeds/demo.sql
```

This creates six clearly named demo users and five events: open football (3/10), full cricket (4/4), cancelled football, completed cricket, and joinable cricket (1/8, hosted by Demo Sara). Default Demo Ali can join/leave the fifth event. They share the three status rows. Fixed IDs prevent duplicate records when rerun; start times are relative to the first seed run and are not refreshed on reruns. Dummy data is not loaded automatically by migrations.

## Checks and generated queries

```sh
go test ./...
TEST_DATABASE_URL="$DATABASE_URL" go test ./... -count=1
sqlc generate
```

The integration test uses a fresh schema in the supplied database, then removes only its own schema. It checks migrations, timestamp ownership, hierarchy/explore responses and event behavior. Run it against a dedicated development database with PostGIS installed in `public`. sqlc 1.31.1 generates `internal/database` from `queries/` and the migrations. Never edit generated files or applied migrations.

Your events uses `GET /me/events?section=upcoming|past&offset=0` (50 events/page, nullable `next_offset`). Hosted and joined events are included independently of map bounds. Past includes cancelled/completed/elapsed events. `PUT /events/{id}/cancellation` lets only the configured demo host cancel upcoming scheduled events; repeat cancellation succeeds. The roster is retained, and cancellation locks the same event row as participation. Native details require confirmation, reconcile after changes, and refresh Your events/map. No notification delivery or schema migration is added.

## Participant messages

Migration 000008 consolidates message timestamps into automatic created_at/updated_at, preserves legacy send times and adds the event/time/UUID index plus a trimmed body constraint. Invalid legacy bodies stop migration for explicit cleanup rather than silently dropping content.

GET /events/{id}/messages returns the latest 50 messages oldest first, has_more, can_send and viewer_id. Pass before=<first cursor> for older history or after=<last cursor> to catch up; continue after pages while has_more. POST accepts {id,body}, where id is a client UUID reused on retries and body trims to 1–2000 Unicode characters. Identical accepted retries return 204; changed content with the same ID returns 409. Both endpoints require current demo membership; leaving returns 403 without deleting history. Cancelled/completed chats are read-only; scheduled chat allows messages after kickoff. Chat access and writes share the participation/cancellation event lock. See openapi.yaml for the full contract.

Reporting and moderation are deferred. Migration 000009 drops the unused reports table and detaches `moderation_log`; migration 000014 removes that empty table after confirming no application code ever read or wrote it. Earlier migration files are unchanged.

## Basic profile

GET /me returns the configured demo user's id, display_name, created_at and updated_at. PATCH /me accepts only {display_name}, trims surrounding whitespace and allows 1–100 Unicode characters on one line. Invalid/unknown fields or bodies over 4 KiB return 400; a missing/unconfigured demo user returns 503. Successful updates return the saved profile with database-managed timestamps. The caller cannot select a user ID. No schema migration or sign-in is added.

## Host editing

PATCH /events/{id} accepts title, starts_at and capacity together (same validation as creation; 16 KiB strict JSON). Only the configured demo host may edit scheduled future events. Place/type remain fixed. The shared event lock serializes edits with join/leave/cancel, and capacity cannot be below current membership. Returns 204; invalid input 400, non-host 403, missing event 404, closed/started or insufficient capacity 409. Automatic timestamps use the existing database trigger.

## Shared realtime transport

Migration 000010 adds the frozen streams/outbox schema and ordered message positions. GET /ws multiplexes event_details and event_messages; GET /realtime provides the long-poll fallback. GET event detail and message pages include decimal-string sequence fields; chat recovery supports after_sequence=N, mutually exclusive with before/after. Message cursors contain only their sequence; the old timestamp/UUID pagination query is removed. Event writes and chat sends publish through the outbox in their existing transactions; no-op retries create no extra update. The API runs its own dispatcher and PostgreSQL notification listener, supplying cross-instance fanout without another service. Demo identity remains configured server-side. See ../docs/realtime.md for protocol, proxy settings, limits and recovery. Published outbox retention is not yet enabled.

## Activity tracking (first slice)

Migration 000011 adds activities, typed action/source/trackable enums, interaction ordering and automatic timestamps. POST /activities accepts bounded batches of client creation/view/join/lifecycle observations with strict per-action details; backend-only outcomes cannot be posted. actor_id must match the configured demo identity. Matching delivery retries are accepted unchanged, conflicting IDs/steps are terminal conflicts, and rejected siblings do not block valid rows. See ../openapi.yaml and ../docs/activities.md for limits and contracts.

Creation, actual participation changes and full/closed rejections record server activities in their existing transactions. Three optional correlation headers link them to frontend attempts; backend steps stay null. Creation receipts include a request hash so retries cannot produce duplicate events. Receipt rows must survive any future retention cleanup. Explore records area/place/event views; the retired Map screen's sport-filter and empty-result actions remain accepted only for historical compatibility. Successful host edits/cancellations are tracked transactionally; chat openings/lifecycle and message_sent are also tracked.

From this directory, run internal reports with psql "$DATABASE_URL" -v from='2026-10-18T00:00:00Z' -v until='2026-10-19T00:00:00Z' -f reports/activities.sql. Cohorts use UTC, a half-open start window and 24-hour follow-up. No public reports API or personal statistics UI is added. Use separate demo/development/production databases; local demo activity is not real-person retention data.

Discovery report: psql "$DATABASE_URL" -v from='2026-10-18T00:00:00Z' -v until='2026-10-19T00:00:00Z' -f reports/discovery.sql. It separates no-events/no-places observations and uses explicit referrer IDs, matching actor/session and actual event/place relationships for place-to-view/join attribution. Recent cohorts have incomplete 24-hour follow-up. Nullable map targets skip entity lookup; targeted activities still validate existence. No migration beyond 000011 is needed.

Hosting report: run the same psql command with `-f reports/hosting.sql` for changed fields, full transitions (join versus capacity reduction), cancellation lead time and membership changes after rescheduling. Edit/cancellation activities use backend timestamps and snapshots; no-op retries add nothing. These endpoints have no client interaction correlation or request receipts; a real later change is recorded again. Database integration tests execute all five report files against fixed, rolled-back fixtures.

Chat engagement: `reports/chat.sql` uses the same from/until psql parameters. It reports join-to-chat/message engagement, chat-visit conversion and missing client starts. POST messages accepts the same three optional activity headers as create/join; keep a pending message’s original correlation through retries. Successful insertions record only an event snapshot, atomically with the message/realtime transaction. Identical retries add no activity.

Session starts: client `session_started` uses its session UUID as activity ID, null interaction/step/source/trackable and empty details. The existing activity primary key deduplicates starts; no migration is added. `reports/sessions.sql` reports daily app visits and observed feature counts matched by actor/session, without inferring duration or real-person retention.
