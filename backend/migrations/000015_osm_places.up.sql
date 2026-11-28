-- Places now come from OpenStreetMap (a weekly job) or, later, from users who
-- drop a pin. The hand-made development catalog (seeds/lahore_catalog.sql) is
-- retired: its places and the demo events at them are removed. LUMS stays: it
-- predates the catalog, carries the community-mapped spots and is OSM way 70017485.
CREATE TYPE place_source AS ENUM ('osm', 'user');
-- Lifecycle, separate from review: a place OSM no longer lists is kept, because
-- events may point at it, and becomes active again if OSM brings it back.
CREATE TYPE place_status AS ENUM ('active', 'missing_from_osm');
CREATE TYPE place_review_status AS ENUM ('unreviewed', 'approved', 'rejected');

DELETE FROM messages WHERE event_id IN (
    SELECT events.id FROM events WHERE events.place_id <> '00000000-0000-4000-8000-000000000100');
DELETE FROM event_participants WHERE event_id IN (
    SELECT events.id FROM events WHERE events.place_id <> '00000000-0000-4000-8000-000000000100');
DELETE FROM events WHERE place_id <> '00000000-0000-4000-8000-000000000100';
DELETE FROM place_spots WHERE place_id <> '00000000-0000-4000-8000-000000000100';
DELETE FROM places WHERE id <> '00000000-0000-4000-8000-000000000100';

ALTER TABLE places
    ADD COLUMN source place_source,
    ADD COLUMN status place_status NOT NULL DEFAULT 'active',
    ADD COLUMN review_status place_review_status NOT NULL DEFAULT 'approved',
    -- OSM element reference, such as way/70017485; the weekly job matches on it.
    ADD COLUMN osm_ref text,
    -- Every OSM tag as fetched (Urdu name, cuisine, opening hours, phone, website).
    ADD COLUMN osm_tags jsonb;

UPDATE places SET source = 'osm', osm_ref = 'way/70017485'
WHERE id = '00000000-0000-4000-8000-000000000100';

ALTER TABLE places
    ALTER COLUMN source SET NOT NULL,
    ADD CONSTRAINT places_osm_ref_format CHECK (osm_ref ~ '^(node|way|relation)/[0-9]+$'),
    ADD CONSTRAINT places_osm_source CHECK ((source = 'osm') = (osm_ref IS NOT NULL)),
    ADD CONSTRAINT places_osm_tags_object CHECK (osm_tags IS NULL OR jsonb_typeof(osm_tags) = 'object'),
    ADD CONSTRAINT places_missing_needs_osm CHECK (status <> 'missing_from_osm' OR source = 'osm');

CREATE UNIQUE INDEX places_osm_ref_idx ON places (osm_ref) WHERE osm_ref IS NOT NULL;
