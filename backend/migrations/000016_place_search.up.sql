-- Place search for the create flow's picker: trigram matching over each place's
-- names, and the picker's three activities. The person's location is never stored.
-- In public, like PostGIS, so every schema on the search path sees its operators.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- Every name a place goes by, lower-cased: the Roman Urdu name we show, plus the
-- Urdu-script, alternative and old names OpenStreetMap knows. Joined with || rather
-- than concat_ws, which Postgres does not accept in a generated column.
ALTER TABLE places ADD COLUMN search_text text GENERATED ALWAYS AS (lower(
    name
    || ' ' || COALESCE(osm_tags->>'name', '')
    || ' ' || COALESCE(osm_tags->>'name:ur', '')
    || ' ' || COALESCE(osm_tags->>'alt_name', '')
    || ' ' || COALESCE(osm_tags->>'old_name', '')
)) STORED;
CREATE INDEX places_search_text_idx ON places USING gin (search_text gin_trgm_ops);
-- Fuzzy matching also compares the shown name on its own: a place with an Urdu
-- name has a much longer search_text, which dilutes similarity to a typed typo.
CREATE INDEX places_name_trgm_idx ON places USING gin (lower(name) gin_trgm_ops);

ALTER TYPE activity_action ADD VALUE 'place_search_selected';
ALTER TYPE activity_action ADD VALUE 'place_search_abandoned';
ALTER TYPE activity_action ADD VALUE 'location_permission_answered';
