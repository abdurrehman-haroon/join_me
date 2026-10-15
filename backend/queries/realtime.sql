-- name: AdvanceRealtimeStream :one
INSERT INTO realtime_streams (target_type, target_id, last_sequence) VALUES ($1, $2, 1)
ON CONFLICT (target_type, target_id) DO UPDATE SET last_sequence = realtime_streams.last_sequence + 1
RETURNING last_sequence;

-- name: GetRealtimeSequence :one
SELECT COALESCE((SELECT last_sequence FROM realtime_streams WHERE target_type = $1 AND target_id = $2), 0)::bigint AS sequence;

-- name: InsertRealtimeUpdate :exec
INSERT INTO realtime_outbox (target_type, target_id, sequence, payload) VALUES ($1, $2, $3, $4);

-- name: WakeRealtimeDispatcher :exec
SELECT pg_notify('realtime_ready', '');

-- name: GetRealtimeUpdate :one
SELECT * FROM realtime_outbox WHERE id = $1;

-- name: LockPendingRealtimeUpdate :one
SELECT * FROM realtime_outbox WHERE published_at IS NULL AND next_attempt_at <= clock_timestamp()
ORDER BY next_attempt_at, created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED;

-- name: PublishRealtimeNotification :exec
SELECT pg_notify('realtime_published', sqlc.arg(update_id)::text);

-- name: MarkRealtimePublished :exec
UPDATE realtime_outbox SET published_at = clock_timestamp(), attempt_count = attempt_count + 1 WHERE id = $1;

-- name: RetryRealtimeUpdate :exec
UPDATE realtime_outbox SET attempt_count = attempt_count + 1,
    next_attempt_at = clock_timestamp() + (LEAST(60, power(2, LEAST(attempt_count, 6))) * interval '1 second')
WHERE id = $1 AND published_at IS NULL;

-- name: CheckRealtimeAccess :one
SELECT EXISTS(SELECT 1 FROM events WHERE id = sqlc.arg(event_id)) AS event_exists,
    EXISTS(SELECT 1 FROM event_participants WHERE event_id = sqlc.arg(event_id) AND user_id = sqlc.arg(user_id)) AS is_participant;
