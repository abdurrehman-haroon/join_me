-- Migration 000002 added these through a uniform timestamp-management loop.
-- Declare them explicitly as well so sqlc sees the complete legacy row types.
-- IF NOT EXISTS preserves databases that have already applied 000002.
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT statement_timestamp();
ALTER TABLE pins ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT statement_timestamp();
ALTER TABLE pin_members ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT statement_timestamp();
ALTER TABLE pin_members ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT statement_timestamp();
ALTER TABLE messages ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT statement_timestamp();
ALTER TABLE messages ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT statement_timestamp();
ALTER TABLE reports ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT statement_timestamp();
ALTER TABLE moderation_log ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT statement_timestamp();
