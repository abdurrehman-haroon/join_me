-- name: GetUser :one
SELECT * FROM users WHERE id = $1;

-- name: UpdateUserName :one
UPDATE users SET display_name = $2 WHERE id = $1
RETURNING *;
