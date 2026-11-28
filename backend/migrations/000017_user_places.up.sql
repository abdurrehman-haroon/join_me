-- Places people pin when what they want is not on the map. A pinned place is
-- created together with its first event. created_by is filled only for private
-- places (homes and the like), which only that person sees in the picker and
-- search; a public pin's creator is the host of the first event there. A
-- rejected place becomes private to whoever pinned it.
ALTER TYPE place_type ADD VALUE 'other';
ALTER TYPE activity_action ADD VALUE 'place_pinned';

ALTER TABLE places
    ADD COLUMN created_by uuid REFERENCES users(id),
    -- A kind typed by the person, kept as written, when no approved kind fits.
    ADD COLUMN kind_text text;

-- Only places people pin can be private.
ALTER TABLE places ADD CONSTRAINT places_private_is_user
    CHECK (created_by IS NULL OR source = 'user');
-- Postgres cannot compare with an enum value added in the same transaction, so
-- the type is compared as text.
ALTER TABLE places ADD CONSTRAINT places_kind_text_other
    CHECK ((type::text = 'other') = (kind_text IS NOT NULL));
ALTER TABLE places ADD CONSTRAINT places_kind_text_length
    CHECK (kind_text IS NULL OR (kind_text = btrim(kind_text) AND length(kind_text) BETWEEN 1 AND 40));

-- The reviewer's queue: public pinned places, newest first.
CREATE INDEX places_review_queue_idx ON places (review_status, created_at)
    WHERE source = 'user' AND created_by IS NULL;
-- Someone's own private places, for their picker and search.
CREATE INDEX places_created_by_idx ON places (created_by) WHERE created_by IS NOT NULL;
