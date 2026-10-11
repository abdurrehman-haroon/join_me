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

These map endpoints are public and read-only. No identity/session, game mutations, or verification is implemented. MapLibre loads background tiles directly from OpenFreeMap; the API serves our places independently.

## Schema and initial data

`areas` supports optional parents and boundaries; `places` references an area and requires a WGS84 point. Both use `type`, backed by PostgreSQL `area_type` and `place_type` enums (migration 000005). Fixed-value fields must use database enums rather than text. All application tables and the migration ledger have database-owned `created_at` and `updated_at`; inserts set both, updates preserve creation time and refresh update time. The PostGIS extension's own metadata tables are not modified. Migration 000004 declares the legacy timestamp columns explicitly for sqlc, since its parser cannot infer the dynamic alterations in 000002.

Migration 000003 seeds the LUMS campus and six community-mapped sports places from OpenStreetMap, retrieved 2026-10-11. Each source way is linked in the migration. These names/outlines are not campus-verified; points are calculated inside their outlines with `ST_PointOnSurface`. Data attribution/license: [OpenStreetMap contributors, ODbL](https://www.openstreetmap.org/copyright). No prototype coordinates are used.

LUMS area ID: `00000000-0000-4000-8000-000000000001`. Additional areas/places are database records; there is no LUMS filter in viewport queries. Parent area relationships are currently managed through reviewed data changes; no administrative write API exists yet. Games referencing places is an agreed future change, not part of this migration.

## Checks and generated queries

```sh
go test ./...
TEST_DATABASE_URL="$DATABASE_URL" go test ./... -count=1
sqlc generate
```

The integration test uses a fresh schema in the supplied database, then removes only its own schema. It checks migrations, timestamp ownership, viewport filtering, missing areas, and bounded results. Run it against a dedicated development database with PostGIS installed in `public`. sqlc 1.31.1 generates `internal/database` from `queries/` and the migrations. Never edit generated files or applied migrations.
