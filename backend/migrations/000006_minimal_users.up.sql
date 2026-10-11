ALTER TABLE users ADD COLUMN display_name text;

-- Legacy users have no display name; preserve their IDs and existing references.
UPDATE users SET display_name = 'User' WHERE display_name IS NULL;

ALTER TABLE users
    ALTER COLUMN id SET DEFAULT gen_random_uuid(),
    ALTER COLUMN display_name SET NOT NULL,
    ADD CONSTRAINT users_display_name_not_blank CHECK (length(btrim(display_name)) > 0),
    DROP COLUMN email,
    DROP COLUMN campus_id,
    DROP COLUMN verified_at;
