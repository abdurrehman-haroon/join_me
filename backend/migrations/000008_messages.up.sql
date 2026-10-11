-- Preserve historical send times as the single canonical message timestamp.
ALTER TABLE messages DROP COLUMN created_at;
ALTER TABLE messages RENAME COLUMN sent_at TO created_at;
ALTER TABLE messages ALTER COLUMN created_at SET DEFAULT statement_timestamp();

-- Invalid legacy bodies stop the migration rather than silently losing content.
ALTER TABLE messages ADD CONSTRAINT messages_body_valid
    CHECK (char_length(body) BETWEEN 1 AND 2000 AND body = btrim(body) AND char_length(btrim(body)) > 0);
CREATE INDEX messages_event_created_id_idx ON messages (event_id, created_at, id);
