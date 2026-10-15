-- name: FindMessage :one
SELECT * FROM messages WHERE id = $1;

-- name: InsertMessage :one
INSERT INTO messages(id, event_id, user_id, body, sequence) VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (id) DO NOTHING RETURNING *;

-- name: ListMessages :many
SELECT messages.*, users.display_name
FROM messages JOIN users ON users.id = messages.user_id
WHERE event_id = sqlc.arg(event_id)
    AND (sqlc.narg(before_time)::timestamptz IS NULL OR
        (messages.created_at, messages.id) < (sqlc.narg(before_time)::timestamptz, sqlc.narg(before_id)::uuid))
    AND (sqlc.narg(after_time)::timestamptz IS NULL OR
        (messages.created_at, messages.id) > (sqlc.narg(after_time)::timestamptz, sqlc.narg(after_id)::uuid))
ORDER BY
    CASE WHEN sqlc.narg(after_time)::timestamptz IS NOT NULL THEN messages.created_at END ASC,
    CASE WHEN sqlc.narg(after_time)::timestamptz IS NOT NULL THEN messages.id END ASC,
    messages.created_at DESC, messages.id DESC
LIMIT 51;

-- name: ListMessagesBySequence :many
SELECT sqlc.embed(messages), users.display_name FROM messages JOIN users ON users.id = messages.user_id
WHERE event_id = sqlc.arg(event_id)
AND (sqlc.narg(after_sequence)::bigint IS NULL OR sequence > sqlc.narg(after_sequence))
AND (sqlc.narg(before_sequence)::bigint IS NULL OR sequence < sqlc.narg(before_sequence))
ORDER BY CASE WHEN sqlc.narg(after_sequence)::bigint IS NOT NULL THEN sequence END ASC, sequence DESC
LIMIT 51;

-- name: GetMessageWithSender :one
SELECT sqlc.embed(messages), users.display_name FROM messages JOIN users ON users.id = messages.user_id WHERE messages.id = $1;
