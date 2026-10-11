CREATE TYPE statusable_type AS ENUM ('event');
CREATE TYPE event_type AS ENUM ('football', 'cricket');

CREATE TABLE status (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    statusable_type statusable_type NOT NULL,
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    slug text NOT NULL UNIQUE CHECK (length(btrim(slug)) > 0),
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

CREATE TRIGGER manage_timestamps BEFORE INSERT OR UPDATE ON status
    FOR EACH ROW EXECUTE FUNCTION manage_row_timestamps();

INSERT INTO status (id, statusable_type, name, slug) VALUES
    ('10000000-0000-4000-8000-000000000001', 'event', 'Scheduled', 'scheduled'),
    ('10000000-0000-4000-8000-000000000002', 'event', 'Cancelled', 'cancelled'),
    ('10000000-0000-4000-8000-000000000003', 'event', 'Completed', 'completed');

ALTER TABLE pins RENAME TO events;
ALTER TABLE events RENAME COLUMN sport TO type;
ALTER TABLE events RENAME COLUMN kickoff_at TO starts_at;
ALTER TABLE events DROP CONSTRAINT pins_sport_check;
ALTER TABLE events ALTER COLUMN type TYPE event_type USING type::event_type;
ALTER TABLE events ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE events ADD COLUMN title text;
ALTER TABLE events ADD COLUMN place_id uuid REFERENCES places(id);
ALTER TABLE events ADD COLUMN status_id uuid REFERENCES status(id);

-- Preserve legacy pin locations instead of silently assigning a different ground.
DO $$
DECLARE
    legacy_event record;
    campus_area_id uuid;
    event_place_id uuid;
BEGIN
    FOR legacy_event IN SELECT * FROM events LOOP
        SELECT id INTO campus_area_id FROM areas
            WHERE name = legacy_event.campus_id AND type = 'campus' ORDER BY id LIMIT 1;
        IF campus_area_id IS NULL THEN
            INSERT INTO areas (name, type) VALUES (legacy_event.campus_id, 'campus')
                RETURNING id INTO campus_area_id;
        END IF;
        INSERT INTO places (area_id, name, type, location)
            VALUES (campus_area_id, legacy_event.ground_name, 'ground', legacy_event.location::geometry)
            RETURNING id INTO event_place_id;
        UPDATE events SET place_id = event_place_id, title = legacy_event.ground_name,
            status_id = CASE WHEN legacy_event.expires_at <= statement_timestamp()
                THEN '10000000-0000-4000-8000-000000000003'::uuid
                ELSE '10000000-0000-4000-8000-000000000001'::uuid END
            WHERE id = legacy_event.id;
    END LOOP;
END;
$$;

ALTER TABLE events
    ALTER COLUMN title SET NOT NULL,
    ADD CONSTRAINT events_title_not_blank CHECK (length(btrim(title)) > 0),
    ALTER COLUMN place_id SET NOT NULL,
    ALTER COLUMN status_id SET NOT NULL,
    DROP COLUMN campus_id,
    DROP COLUMN ground_name,
    DROP COLUMN location,
    DROP COLUMN expires_at,
    DROP COLUMN visibility;

ALTER TABLE pin_members RENAME TO event_participants;
ALTER TABLE event_participants RENAME COLUMN pin_id TO event_id;
ALTER TABLE event_participants DROP COLUMN joined_at;
ALTER TABLE messages RENAME COLUMN pin_id TO event_id;

-- Existing hosts occupy one spot just like every other participant.
INSERT INTO event_participants (event_id, user_id)
    SELECT id, host_id FROM events ON CONFLICT (event_id, user_id) DO NOTHING;
