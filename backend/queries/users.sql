-- name: GetUser :one
SELECT * FROM users WHERE id = $1;

-- name: UpdateUserName :one
UPDATE users SET display_name = $2 WHERE id = $1
RETURNING *;

-- name: UpdateUserEventGoal :one
UPDATE users SET event_goal_target = sqlc.narg(event_goal_target)::integer,
    event_goal_period = sqlc.narg(event_goal_period)::event_goal_period
WHERE id = sqlc.arg(id)
RETURNING event_goal_target, event_goal_period;
