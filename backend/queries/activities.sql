-- name: InsertActivity :execrows
INSERT INTO activities (id, action, user_id, session_id, interaction_id, interaction_step,
    trackable_type, trackable_id, source, occurred_at, details)
VALUES (COALESCE(sqlc.narg(id)::uuid, gen_random_uuid()), sqlc.arg(action), sqlc.narg(user_id),
    sqlc.narg(session_id), sqlc.narg(interaction_id), sqlc.narg(interaction_step),
    sqlc.narg(trackable_type), sqlc.narg(trackable_id), sqlc.narg(source),
    COALESCE(sqlc.narg(occurred_at)::timestamptz, statement_timestamp()), sqlc.arg(details))
ON CONFLICT DO NOTHING;

-- name: GetActivity :one
SELECT * FROM activities WHERE id = $1;

-- name: ActivityTargetExists :one
SELECT CASE sqlc.arg(trackable_type)::activity_trackable_type
    WHEN 'event' THEN EXISTS(SELECT 1 FROM events WHERE events.id = sqlc.arg(trackable_id))
    WHEN 'place' THEN EXISTS(SELECT 1 FROM places WHERE places.id = sqlc.arg(trackable_id))
END::boolean AS target_exists;

-- name: LockActivityRequest :exec
SELECT pg_advisory_xact_lock(hashtextextended(sqlc.arg(request_key)::text, 19));

-- name: GetActivitySnapshot :one
SELECT jsonb_build_object('snapshot', jsonb_build_object(
    'participant_count', (SELECT count(*) FROM event_participants WHERE event_id = events.id),
    'capacity', capacity, 'starts_at', starts_at, 'status', status.slug
))::jsonb AS details
FROM events JOIN status ON status.id = events.status_id WHERE events.id = $1;
