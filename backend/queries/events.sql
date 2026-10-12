-- name: GetScheduledEventStatus :one
SELECT id FROM status WHERE statusable_type = 'event' AND slug = 'scheduled';

-- name: CreateEvent :one
-- Creating the host membership in the same statement keeps creation atomic.
WITH created_event AS (
    INSERT INTO events (host_id, place_id, status_id, title, type, starts_at, capacity)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
), added_host AS (
    INSERT INTO event_participants (event_id, user_id)
    SELECT id, host_id FROM created_event
    RETURNING event_id
)
SELECT created_event.* FROM created_event
JOIN added_host ON added_host.event_id = created_event.id;

-- name: ListEventsInBounds :one
WITH matching_events AS (
    SELECT events.*, places.name AS place_name, places.location,
        users.display_name AS host_name, status.name AS status_name, status.slug AS status_slug
    FROM events
    JOIN places ON places.id = events.place_id
    JOIN users ON users.id = events.host_id
    JOIN status ON status.id = events.status_id
    WHERE places.location && ST_MakeEnvelope(
        sqlc.arg(west)::float8, sqlc.arg(south)::float8,
        sqlc.arg(east)::float8, sqlc.arg(north)::float8, 4326)
        AND starts_at > statement_timestamp()
        AND status.statusable_type = 'event' AND status.slug = 'scheduled'
        AND (sqlc.arg(event_filter)::text = '' OR events.type::text = sqlc.arg(event_filter)::text)
), limited_events AS (
    SELECT *, row_number() OVER (ORDER BY starts_at, id) AS position
    FROM matching_events ORDER BY starts_at, id LIMIT 1001
), event_summaries AS (
    SELECT limited_events.*, (SELECT count(*) FROM event_participants
        WHERE event_id = limited_events.id) AS participant_count
    FROM limited_events
)
SELECT jsonb_build_object(
    'truncated', (SELECT count(*) > 1000 FROM limited_events),
    'place_counts', COALESCE((SELECT jsonb_object_agg(place_id, event_count) FROM (
        SELECT place_id, count(*) AS event_count FROM matching_events GROUP BY place_id
    ) AS counts), '{}'::jsonb),
    'events', COALESCE(jsonb_agg(jsonb_build_object(
        'id', id, 'title', title, 'type', type, 'starts_at', starts_at, 'capacity', capacity,
        'host', jsonb_build_object('id', host_id, 'display_name', host_name),
        'place', jsonb_build_object('id', place_id, 'name', place_name,
            'coordinates', ST_AsGeoJSON(location)::jsonb->'coordinates'),
        'status', jsonb_build_object('id', status_id, 'name', status_name, 'slug', status_slug),
        'participant_count', participant_count, 'available_spots', GREATEST(capacity - participant_count, 0),
        'is_full', participant_count >= capacity, 'created_at', created_at, 'updated_at', updated_at
    ) ORDER BY starts_at, id) FILTER (WHERE position <= 1000), '[]'::jsonb)
)::jsonb AS events
FROM event_summaries;

-- name: GetEvent :one
WITH event_detail AS (
    SELECT events.*, places.name AS place_name, places.location,
        users.display_name AS host_name, status.name AS status_name, status.slug AS status_slug,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id', participants.id,
            'display_name', participants.display_name) ORDER BY membership.created_at, participants.id)
            FROM event_participants AS membership JOIN users AS participants ON participants.id = membership.user_id
            WHERE membership.event_id = events.id), '[]'::jsonb) AS participants
    FROM events JOIN places ON places.id = events.place_id
    JOIN users ON users.id = events.host_id JOIN status ON status.id = events.status_id
    WHERE events.id = sqlc.arg(id) AND status.statusable_type = 'event'
)
SELECT jsonb_build_object(
    'id', id, 'title', title, 'type', type, 'starts_at', starts_at, 'capacity', capacity,
    'host', jsonb_build_object('id', host_id, 'display_name', host_name),
    'place', jsonb_build_object('id', place_id, 'name', place_name,
        'coordinates', ST_AsGeoJSON(location)::jsonb->'coordinates'),
    'status', jsonb_build_object('id', status_id, 'name', status_name, 'slug', status_slug),
    'viewer', jsonb_build_object('id', sqlc.narg(viewer_id)::uuid,
        'is_host', COALESCE(host_id = sqlc.narg(viewer_id)::uuid, false),
        'is_participant', EXISTS(SELECT 1 FROM event_participants WHERE event_id = event_detail.id AND user_id = sqlc.narg(viewer_id)::uuid)),
    'participants', participants, 'participant_count', jsonb_array_length(participants),
    'available_spots', GREATEST(capacity - jsonb_array_length(participants), 0),
    'is_full', jsonb_array_length(participants) >= capacity,
    'created_at', created_at, 'updated_at', updated_at
)::jsonb AS event FROM event_detail;

-- name: DemoUserExists :one
SELECT EXISTS(SELECT 1 FROM users WHERE id = $1);

-- name: LockEventForParticipation :one
SELECT host_id, capacity, starts_at, status_id
FROM events WHERE id = $1 FOR UPDATE;

-- name: GetEventStatusSlug :one
SELECT slug FROM status WHERE id = $1 AND statusable_type = 'event';

-- name: GetEventParticipation :one
SELECT count(*) AS participant_count,
    COALESCE(bool_or(user_id = sqlc.arg(user_id)), false)::boolean AS joined
FROM event_participants WHERE event_id = sqlc.arg(event_id);

-- name: JoinEvent :exec
INSERT INTO event_participants (event_id, user_id) VALUES ($1, $2)
ON CONFLICT (event_id, user_id) DO NOTHING;

-- name: LeaveEvent :exec
DELETE FROM event_participants WHERE event_id = $1 AND user_id = $2;

-- name: ListUserEvents :one
WITH matching_events AS (
    SELECT events.*, places.name AS place_name, places.location,
        users.display_name AS host_name, status.name AS status_name, status.slug AS status_slug
    FROM events
    JOIN places ON places.id = events.place_id
    JOIN users ON users.id = events.host_id
    JOIN status ON status.id = events.status_id
    WHERE status.statusable_type = 'event'
        AND (host_id = sqlc.arg(user_id)::uuid OR EXISTS (
            SELECT 1 FROM event_participants WHERE event_id = events.id AND user_id = sqlc.arg(user_id)::uuid))
        AND ((status.slug = 'scheduled' AND starts_at > statement_timestamp()) = (sqlc.arg(section)::text = 'upcoming'))
), limited_events AS (
    SELECT *, row_number() OVER (ORDER BY
        CASE WHEN sqlc.arg(section)::text = 'upcoming' THEN starts_at END ASC,
        CASE WHEN sqlc.arg(section)::text = 'past' THEN starts_at END DESC, id) AS position
    FROM matching_events ORDER BY position LIMIT 51 OFFSET sqlc.arg(page_offset)::int
), event_summaries AS (
    SELECT limited_events.*, (SELECT count(*) FROM event_participants
        WHERE event_id = limited_events.id) AS participant_count
    FROM limited_events
)
SELECT jsonb_build_object(
    'next_offset', CASE WHEN (SELECT count(*) FROM limited_events) > 50 THEN sqlc.arg(page_offset)::int + 50 ELSE NULL END,
    'events', COALESCE(jsonb_agg(jsonb_build_object(
        'id', id, 'title', title, 'type', type, 'starts_at', starts_at, 'capacity', capacity,
        'host', jsonb_build_object('id', host_id, 'display_name', host_name),
        'place', jsonb_build_object('id', place_id, 'name', place_name,
            'coordinates', ST_AsGeoJSON(location)::jsonb->'coordinates'),
        'status', jsonb_build_object('id', status_id, 'name', status_name, 'slug', status_slug),
        'participant_count', participant_count, 'available_spots', GREATEST(capacity - participant_count, 0),
        'is_full', participant_count >= capacity, 'created_at', created_at, 'updated_at', updated_at
    ) ORDER BY position) FILTER (WHERE position <= sqlc.arg(page_offset)::int + 50), '[]'::jsonb)
)::jsonb AS events
FROM event_summaries;


-- name: GetCancelledEventStatus :one
SELECT id FROM status WHERE statusable_type = 'event' AND slug = 'cancelled';

-- name: CancelEvent :exec
UPDATE events SET status_id = $2 WHERE id = $1;

-- name: UpdateEvent :exec
UPDATE events SET title = $2, starts_at = $3, capacity = $4 WHERE id = $1;
