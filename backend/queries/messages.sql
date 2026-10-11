-- name: FindMessage :one
SELECT * FROM messages WHERE id = $1;

-- name: InsertMessage :one
INSERT INTO messages(id, event_id, user_id, body) VALUES ($1, $2, $3, $4)
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
