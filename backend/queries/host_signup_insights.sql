-- name: GetHostSignupInsights :one
WITH hosted_event AS (
    SELECT * FROM events
    WHERE events.id = sqlc.arg(event_id) AND events.host_id = sqlc.arg(user_id)
), event_actions AS (
    SELECT activities.* FROM activities JOIN hosted_event ON hosted_event.id = trackable_id
    WHERE trackable_type = 'event'
        AND action IN ('event_created', 'participation_joined', 'participation_left', 'event_edited')
), known_signups AS (
    SELECT user_id, occurred_at AS joined_at FROM event_actions, hosted_event
    WHERE action = 'participation_joined' AND user_id <> hosted_event.host_id
    UNION ALL
    SELECT user_id, event_participants.created_at
    FROM event_participants JOIN hosted_event ON hosted_event.id = event_id
    WHERE user_id <> hosted_event.host_id
), known_players AS (
    SELECT user_id FROM known_signups
    UNION
    -- A recorded leave also proves an older signup, even if that signup predates tracking.
    SELECT user_id FROM event_actions, hosted_event
    WHERE action = 'participation_left' AND user_id <> hosted_event.host_id
), full_milestones AS (
    SELECT event_actions.id, occurred_at,
        CASE action WHEN 'participation_joined' THEN 'signup'
            WHEN 'event_edited' THEN 'capacity_reduction'
            ELSE 'initial_capacity' END AS reason
    FROM event_actions, hosted_event
    WHERE (details->'snapshot'->>'participant_count')::integer = (details->'snapshot'->>'capacity')::integer
        AND (
            action = 'participation_joined' AND user_id <> hosted_event.host_id
            OR action = 'event_created' AND user_id = hosted_event.host_id
            OR action = 'event_edited' AND user_id = hosted_event.host_id
                AND (details->'changes'->'capacity'->>'before')::integer > (details->'snapshot'->>'capacity')::integer
        )
    ORDER BY occurred_at, event_actions.id LIMIT 1
)
SELECT (SELECT jsonb_build_object(
    'history_complete', EXISTS(SELECT 1 FROM event_actions WHERE action = 'event_created' AND user_id = hosted_event.host_id),
    'unique_players_joined', (SELECT count(*) FROM known_players),
    'unique_players_left', (SELECT count(DISTINCT user_id) FROM event_actions
        WHERE action = 'participation_left' AND user_id <> hosted_event.host_id),
    'first_signup_at', (SELECT min(joined_at) FROM known_signups),
    'first_signup_seconds', (SELECT CASE WHEN min(joined_at) IS NOT NULL THEN GREATEST(0, floor(extract(epoch FROM min(joined_at) - hosted_event.created_at)))::bigint END FROM known_signups),
    'first_full_at', (SELECT occurred_at FROM full_milestones),
    'first_full_seconds', (SELECT GREATEST(0, floor(extract(epoch FROM occurred_at - hosted_event.created_at)))::bigint FROM full_milestones),
    'first_full_reason', (SELECT reason FROM full_milestones)
) FROM hosted_event)::jsonb AS insights
FROM events WHERE events.id = sqlc.arg(event_id);
