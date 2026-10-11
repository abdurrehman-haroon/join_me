CREATE TABLE areas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id uuid REFERENCES areas(id),
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    type text NOT NULL CHECK (type IN ('city', 'district', 'campus')),
    boundary geometry(MultiPolygon, 4326),
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    CHECK (parent_id IS DISTINCT FROM id),
    CHECK (boundary IS NULL OR (NOT ST_IsEmpty(boundary) AND ST_IsValid(boundary)))
);

CREATE TABLE places (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    area_id uuid NOT NULL REFERENCES areas(id),
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    type text NOT NULL CHECK (type IN ('ground', 'court', 'cafe', 'park')),
    location geometry(Point, 4326) NOT NULL,
    boundary geometry(MultiPolygon, 4326),
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    CHECK (NOT ST_IsEmpty(location) AND ST_X(location) BETWEEN -180 AND 180 AND ST_Y(location) BETWEEN -90 AND 90),
    CHECK (boundary IS NULL OR (NOT ST_IsEmpty(boundary) AND ST_IsValid(boundary)))
);

CREATE INDEX places_location_idx ON places USING gist (location);
CREATE INDEX places_area_id_idx ON places (area_id);
CREATE INDEX areas_parent_id_idx ON areas (parent_id);

-- Timestamp ownership belongs to PostgreSQL, including explicit timestamp writes.
CREATE FUNCTION manage_row_timestamps() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.created_at := statement_timestamp();
    ELSE
        NEW.created_at := OLD.created_at;
    END IF;
    NEW.updated_at := statement_timestamp();
    RETURN NEW;
END;
$$;

-- Bring the existing tables and the migration ledger under the same timestamp rule.
DO $$
DECLARE
    table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['users', 'pins', 'pin_members', 'messages', 'reports', 'moderation_log', 'areas', 'places', 'schema_migrations'] LOOP
        EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT statement_timestamp()', table_name);
        EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT statement_timestamp()', table_name);
        EXECUTE format('CREATE TRIGGER manage_timestamps BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION manage_row_timestamps()', table_name);
    END LOOP;
END;
$$;
