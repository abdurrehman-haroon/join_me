CREATE TYPE realtime_target_type AS ENUM ('event_details', 'event_messages');
CREATE TABLE realtime_streams (
    target_type realtime_target_type NOT NULL,
    target_id uuid NOT NULL,
    last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    PRIMARY KEY (target_type, target_id)
);
CREATE TRIGGER manage_timestamps BEFORE INSERT OR UPDATE ON realtime_streams
    FOR EACH ROW EXECUTE FUNCTION manage_row_timestamps();
CREATE TABLE realtime_outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type realtime_target_type NOT NULL,
    target_id uuid NOT NULL,
    sequence bigint NOT NULL CHECK (sequence > 0),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    FOREIGN KEY (target_type, target_id) REFERENCES realtime_streams (target_type, target_id),
    UNIQUE (target_type, target_id, sequence)
);
CREATE TRIGGER manage_timestamps BEFORE INSERT OR UPDATE ON realtime_outbox
    FOR EACH ROW EXECUTE FUNCTION manage_row_timestamps();
CREATE INDEX realtime_outbox_pending_idx ON realtime_outbox (next_attempt_at, created_at, id)
    WHERE published_at IS NULL;
ALTER TABLE messages ADD COLUMN sequence bigint;
WITH ordered_messages AS (
    SELECT id, row_number() OVER (PARTITION BY event_id ORDER BY created_at, id) AS sequence FROM messages
)
UPDATE messages SET sequence = ordered_messages.sequence
FROM ordered_messages WHERE messages.id = ordered_messages.id;
ALTER TABLE messages ALTER COLUMN sequence SET NOT NULL;
ALTER TABLE messages ADD CONSTRAINT messages_sequence_positive CHECK (sequence > 0);
ALTER TABLE messages ADD CONSTRAINT messages_event_sequence_unique UNIQUE (event_id, sequence);
INSERT INTO realtime_streams (target_type, target_id) SELECT 'event_details', id FROM events;
INSERT INTO realtime_streams (target_type, target_id, last_sequence)
    SELECT 'event_messages', events.id, COALESCE(max(messages.sequence), 0)
    FROM events LEFT JOIN messages ON messages.event_id = events.id GROUP BY events.id;
