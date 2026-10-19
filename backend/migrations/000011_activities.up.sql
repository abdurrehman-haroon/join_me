CREATE TYPE activity_action AS ENUM (
    'session_started', 'sport_filter_selected', 'place_viewed', 'event_viewed',
    'empty_results_viewed', 'event_creation_started', 'event_creation_submitted',
    'event_created', 'event_edited', 'event_cancelled', 'join_attempted',
    'participation_joined', 'join_rejected', 'participation_left', 'chat_opened',
    'message_sent', 'interaction_paused', 'interaction_resumed', 'interaction_closed'
);
CREATE TYPE activity_trackable_type AS ENUM ('event', 'place');
CREATE TYPE activity_source AS ENUM (
    'map', 'place_details', 'event_details', 'event_form', 'event_chat', 'your_events', 'profile'
);
CREATE TABLE activities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    action activity_action NOT NULL,
    user_id uuid REFERENCES users(id),
    session_id uuid,
    interaction_id uuid,
    interaction_step integer CHECK (interaction_step > 0),
    trackable_type activity_trackable_type,
    trackable_id uuid,
    source activity_source,
    occurred_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    details jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(details) = 'object'),
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    CHECK ((trackable_type IS NULL) = (trackable_id IS NULL)),
    CHECK (interaction_step IS NULL OR interaction_id IS NOT NULL),
    UNIQUE (interaction_id, interaction_step)
);
CREATE TRIGGER manage_timestamps BEFORE INSERT OR UPDATE ON activities
    FOR EACH ROW EXECUTE FUNCTION manage_row_timestamps();
CREATE INDEX activities_action_time_idx ON activities(action, occurred_at);
