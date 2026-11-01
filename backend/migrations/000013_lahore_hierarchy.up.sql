ALTER TABLE areas ADD COLUMN slug text;
ALTER TABLE areas ADD COLUMN sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0);
ALTER TABLE places ADD COLUMN slug text;
ALTER TABLE places ADD COLUMN sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0);

CREATE TYPE spot_type AS ENUM ('ground', 'court', 'pool', 'hall', 'room', 'other');

CREATE TABLE place_spots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    place_id uuid NOT NULL REFERENCES places(id),
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    slug text NOT NULL CHECK (slug = lower(slug) AND slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    type spot_type NOT NULL,
    location geometry(Point, 4326) NOT NULL,
    boundary geometry(MultiPolygon, 4326),
    sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    CHECK (NOT ST_IsEmpty(location) AND ST_X(location) BETWEEN -180 AND 180 AND ST_Y(location) BETWEEN -90 AND 90),
    CHECK (boundary IS NULL OR (NOT ST_IsEmpty(boundary) AND ST_IsValid(boundary))),
    UNIQUE (place_id, slug),
    UNIQUE (id, place_id)
);

CREATE TRIGGER manage_timestamps BEFORE INSERT OR UPDATE ON place_spots
    FOR EACH ROW EXECUTE FUNCTION manage_row_timestamps();
CREATE INDEX place_spots_place_order_idx ON place_spots (place_id, sort_order);
CREATE INDEX place_spots_location_idx ON place_spots USING gist (location);

ALTER TABLE events ADD COLUMN spot_id uuid;
ALTER TABLE events ADD CONSTRAINT events_spot_place_fkey
    FOREIGN KEY (spot_id, place_id) REFERENCES place_spots(id, place_id);

-- Convert the original LUMS-only geography without losing existing events.
INSERT INTO areas (id, name, slug, type, sort_order)
VALUES ('00000000-0000-4000-8000-000000000101', 'Lahore', 'lahore', 'city', 10)
ON CONFLICT (id) DO NOTHING;

INSERT INTO areas (id, parent_id, name, slug, type, sort_order)
VALUES (
    '00000000-0000-4000-8000-000000000102',
    '00000000-0000-4000-8000-000000000101',
    'DHA Phase 5', 'dha-phase-5', 'district', 50
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO places (id, area_id, name, slug, type, location, boundary, sort_order)
SELECT
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000102',
    'LUMS', 'lums', 'park',
    ST_SetSRID(ST_Point(74.409, 31.47), 4326),
    boundary,
    10
FROM areas
WHERE id = '00000000-0000-4000-8000-000000000001'
ON CONFLICT (id) DO NOTHING;

INSERT INTO place_spots (id, place_id, name, slug, type, location, boundary, sort_order, created_at, updated_at)
SELECT
    id,
    '00000000-0000-4000-8000-000000000100',
    name,
    trim(both '-' FROM regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')),
    CASE type WHEN 'court' THEN 'court'::spot_type ELSE 'ground'::spot_type END,
    location,
    boundary,
    row_number() OVER (ORDER BY name) * 10,
    created_at,
    updated_at
FROM places
WHERE area_id = '00000000-0000-4000-8000-000000000001'
ON CONFLICT (id) DO NOTHING;

UPDATE events
SET spot_id = place_id,
    place_id = '00000000-0000-4000-8000-000000000100'
WHERE place_id IN (
    SELECT id FROM place_spots
    WHERE place_id = '00000000-0000-4000-8000-000000000100'
);

-- Some development databases briefly carried experimental scene metadata.
-- Preserve it on the containing district when that optional table exists.
DO $$
BEGIN
    IF to_regclass('area_scene_sources') IS NOT NULL THEN
        EXECUTE 'INSERT INTO area_scene_sources (area_id, source_key, attribution, url, created_at, updated_at)
            SELECT $1, source_key, attribution, url, created_at, updated_at
            FROM area_scene_sources WHERE area_id = $2 ON CONFLICT DO NOTHING'
        USING '00000000-0000-4000-8000-000000000102'::uuid,
              '00000000-0000-4000-8000-000000000001'::uuid;
        EXECUTE 'UPDATE area_buildings SET area_id = $1 WHERE area_id = $2'
        USING '00000000-0000-4000-8000-000000000102'::uuid,
              '00000000-0000-4000-8000-000000000001'::uuid;
        EXECUTE 'UPDATE area_paths SET area_id = $1 WHERE area_id = $2'
        USING '00000000-0000-4000-8000-000000000102'::uuid,
              '00000000-0000-4000-8000-000000000001'::uuid;
        EXECUTE 'DELETE FROM area_scene_sources WHERE area_id = $1'
        USING '00000000-0000-4000-8000-000000000001'::uuid;
    END IF;
END;
$$;

DELETE FROM places WHERE area_id = '00000000-0000-4000-8000-000000000001';
DELETE FROM areas WHERE id = '00000000-0000-4000-8000-000000000001';

UPDATE areas
SET slug = trim(both '-' FROM regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'))
WHERE slug IS NULL;
UPDATE places
SET slug = trim(both '-' FROM regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'))
WHERE slug IS NULL;

ALTER TABLE areas ALTER COLUMN slug SET NOT NULL;
ALTER TABLE areas ADD CONSTRAINT areas_slug_format CHECK (slug = lower(slug) AND slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');
CREATE UNIQUE INDEX areas_city_slug_idx ON areas (slug) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX areas_child_slug_idx ON areas (parent_id, slug) WHERE parent_id IS NOT NULL;
CREATE INDEX areas_parent_order_idx ON areas (parent_id, sort_order);

ALTER TABLE places ALTER COLUMN slug SET NOT NULL;
ALTER TABLE places ADD CONSTRAINT places_slug_format CHECK (slug = lower(slug) AND slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');
CREATE UNIQUE INDEX places_area_slug_idx ON places (area_id, slug);
CREATE INDEX places_area_order_idx ON places (area_id, sort_order);

ALTER TABLE events ALTER COLUMN type TYPE text USING type::text;
DROP TYPE event_type;
ALTER TABLE events ADD CONSTRAINT events_type_length CHECK (
    length(btrim(type)) BETWEEN 1 AND 50 AND type = btrim(type)
);

ALTER TABLE areas ALTER COLUMN type TYPE text USING type::text;
DROP TYPE area_type;
CREATE TYPE area_type AS ENUM ('city', 'district');
ALTER TABLE areas ALTER COLUMN type TYPE area_type USING type::area_type;

ALTER TABLE places ALTER COLUMN type TYPE text USING type::text;
DROP TYPE place_type;
CREATE TYPE place_type AS ENUM (
    'campus', 'cafe', 'restaurant', 'park', 'mall', 'sports_club',
    'stadium', 'culture', 'heritage', 'hotel', 'exhibition', 'community'
);
UPDATE places SET type = 'campus' WHERE id = '00000000-0000-4000-8000-000000000100';
ALTER TABLE places ALTER COLUMN type TYPE place_type USING type::place_type;

ALTER TYPE activity_trackable_type ADD VALUE 'area';
ALTER TYPE activity_action ADD VALUE 'area_viewed';
ALTER TYPE activity_source ADD VALUE 'explore';
