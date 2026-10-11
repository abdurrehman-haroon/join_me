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

## Map endpoints

- `GET /healthz`
- `GET /areas/{uuid}`: area, optional GeoJSON boundary, and view bounds. Bounds fall back to that area's directly attached places when its outline is absent; null means there is no view data yet.
- `GET /places?bbox=west,south,east,north`: GeoJSON place points with metadata and optional outlines. Returns at most 1000; `truncated: true` asks the client to zoom in. Bounds cannot cross the antimeridian yet.

These map endpoints are public and read-only. No identity/session or verification is implemented. Event creation uses a temporary demo host. MapLibre loads background tiles directly from OpenFreeMap; the API serves our places independently.

## Event browsing endpoints

- `GET /events?bbox=west,south,east,north&type=football`: scheduled future events in viewport, optional football/cricket filter (omit or empty for all), ordered by starts_at then ID. Returns at most 1000 summaries, `truncated`, and exact `place_counts` even beyond that limit. Full events remain visible. Client should zoom in if truncated.
- `GET /events/{uuid}`: event with host, place, shared status, participants, count, available spots and fullness. Cancelled, completed and elapsed events remain accessible by ID. Missing UUID returns 404; malformed UUID/bounds/type returns 400.

Both are public read-only and specified in `../openapi.yaml`. Participant counts include the host. Event creation is described below; no identity endpoints are exposed.

## Event creation

`POST /events` accepts `{place_id,title,type,starts_at,capacity}`. Title is trimmed and must have 1–200 characters; type is football/cricket; starts_at is a future RFC3339 time with offset or Z; capacity is a positive int32 including the host. Unknown fields, malformed/extra JSON and bodies over 16 KiB are rejected with 400. Missing place returns 404. The server assigns the shared scheduled status and demo host, then creates the event and host membership atomically. Returns 201 with `{id}` and Location `/events/{id}`.

`DEMO_USER_ID` defaults to `20000000-0000-4000-8000-000000000001` (Demo Ali). Load `seeds/demo.sql` before creating events, or configure an existing user ID. Missing demo user or scheduled status returns 503. The request cannot choose a host or status. This is temporary shared demo identity until sign-in is implemented. There is no automatic POST retry or idempotency key; after a network timeout, check the event list before resubmitting.

## Joining and leaving

`PUT /events/{id}/participation` joins as `DEMO_USER_ID`. `DELETE` on the same path leaves. Neither accepts a user ID or needs a body. Both lock the event row in a READ COMMITTED transaction; membership/count queries run after acquiring the lock so concurrent joins see committed changes. Capacity includes the host. Already joined (even if now full/closed) and already absent return 204 without changing membership. New joins require scheduled status, a future start and available capacity. Full/closed or host-leave attempts return 409; missing event 404; unavailable demo user 503. Non-host participants may leave regardless of event status/time. Hosts remain participants when their event is cancelled.

Event details include `viewer: {id,is_host,is_participant}` for the configured demo user. The mobile UI uses these flags and refreshes details/counts after participation attempts. Future participant/capacity/status mutation endpoints must use the same event lock. Direct SQL writes bypass these service-level capacity rules.

## Schema and initial data

`areas` supports optional parents and boundaries; `places` references an area and requires a WGS84 point. Both use `type`, backed by PostgreSQL `area_type` and `place_type` enums (migration 000005). Fixed-value fields must use database enums rather than text. All application tables and the migration ledger have database-owned `created_at` and `updated_at`; inserts set both, updates preserve creation time and refresh update time. The PostGIS extension's own metadata tables are not modified. Migration 000004 declares the legacy timestamp columns explicitly for sqlc, since its parser cannot infer the dynamic alterations in 000002.

Migration 000006 simplifies `users` to a generated UUID, required nonblank `display_name`, and automatic timestamps. Email, campus and verification fields are removed; existing user IDs/references are retained with placeholder display name `User`. Profile endpoints and frontend are deferred.

Migration 000003 seeds the LUMS campus and six community-mapped sports places from OpenStreetMap, retrieved 2026-10-11. Each source way is linked in the migration. These names/outlines are not campus-verified; points are calculated inside their outlines with `ST_PointOnSurface`. Data attribution/license: [OpenStreetMap contributors, ODbL](https://www.openstreetmap.org/copyright). No prototype coordinates are used.

LUMS area ID: `00000000-0000-4000-8000-000000000001`. Additional areas/places are database records; there is no LUMS filter in viewport queries. Parent area relationships are currently managed through reviewed data changes; no administrative write API exists yet. Events reference places through place_id.

## Events and optional demo data

Migration 000007 replaces `pins`/`pin_members` with `events`/`event_participants` and renames `messages.pin_id` to `event_id`, preserving foreign keys. Shared `status` rows have unique slugs and the `statusable_type` enum (initially event), without a target-record ID. `events.status_id` references a shared status. Initial statuses are scheduled, cancelled and completed. Event types are PostgreSQL enum football/cricket. All new tables have automatic timestamps.

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

The integration test uses a fresh schema in the supplied database, then removes only its own schema. It checks migrations, timestamp ownership, viewport filtering, missing areas, and bounded results. Run it against a dedicated development database with PostGIS installed in `public`. sqlc 1.31.1 generates `internal/database` from `queries/` and the migrations. Never edit generated files or applied migrations.

Your events uses `GET /me/events?section=upcoming|past&offset=0` (50 events/page, nullable `next_offset`). Hosted and joined events are included independently of map bounds. Past includes cancelled/completed/elapsed events. `PUT /events/{id}/cancellation` lets only the configured demo host cancel upcoming scheduled events; repeat cancellation succeeds. The roster is retained, and cancellation locks the same event row as participation. Native details require confirmation, reconcile after changes, and refresh Your events/map. No notification delivery or schema migration is added.

## Participant messages

Migration 000008 consolidates message timestamps into automatic created_at/updated_at, preserves legacy send times and adds the event/time/UUID index plus a trimmed body constraint. Invalid legacy bodies stop migration for explicit cleanup rather than silently dropping content.

GET /events/{id}/messages returns the latest 50 messages oldest first, has_more, can_send and viewer_id. Pass before=<first cursor> for older history or after=<last cursor> to catch up; continue after pages while has_more. POST accepts {id,body}, where id is a client UUID reused on retries and body trims to 1–2000 Unicode characters. Identical accepted retries return 204; changed content with the same ID returns 409. Both endpoints require current demo membership; leaving returns 403 without deleting history. Cancelled/completed chats are read-only; scheduled chat allows messages after kickoff. Chat access and writes share the participation/cancellation event lock. See openapi.yaml for the full contract.
