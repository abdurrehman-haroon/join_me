-- name: FindMessage :one
SELECT * FROM messages WHERE id = $1;

-- name: InsertMessage :one
INSERT INTO messages(id, event_id, user_id, body, sequence) VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (id) DO NOTHING RETURNING *;

-- name: ListMessages :many
SELECT sqlc.embed(messages), users.display_name FROM messages JOIN users ON users.id = messages.user_id
WHERE event_id = sqlc.arg(event_id)
AND (sqlc.narg(after_sequence)::bigint IS NULL OR sequence > sqlc.narg(after_sequence))
AND (sqlc.narg(before_sequence)::bigint IS NULL OR sequence < sqlc.narg(before_sequence))
ORDER BY CASE WHEN sqlc.narg(after_sequence)::bigint IS NOT NULL THEN sequence END ASC, sequence DESC
LIMIT 51;

-- name: GetMessageWithSender :one
SELECT sqlc.embed(messages), users.display_name FROM messages JOIN users ON users.id = messages.user_id WHERE messages.id = $1;
