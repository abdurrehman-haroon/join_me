-- name: GetUserActivity :one
WITH report_periods AS (
    SELECT
        date_trunc('week', sqlc.arg(until)::timestamptz AT TIME ZONE sqlc.arg(timezone)::text)
            AT TIME ZONE sqlc.arg(timezone)::text AS week_start,
        (date_trunc('week', sqlc.arg(until)::timestamptz AT TIME ZONE sqlc.arg(timezone)::text) + interval '1 week')
            AT TIME ZONE sqlc.arg(timezone)::text AS week_end,
        date_trunc('month', sqlc.arg(until)::timestamptz AT TIME ZONE sqlc.arg(timezone)::text)
            AT TIME ZONE sqlc.arg(timezone)::text AS month_start,
        (date_trunc('month', sqlc.arg(until)::timestamptz AT TIME ZONE sqlc.arg(timezone)::text) + interval '1 month')
            AT TIME ZONE sqlc.arg(timezone)::text AS month_end,
        (date_trunc('month', sqlc.arg(until)::timestamptz AT TIME ZONE sqlc.arg(timezone)::text) - interval '1 month')
            AT TIME ZONE sqlc.arg(timezone)::text AS previous_month_start
), eligible_signups AS (
    -- Goal/milestone eligibility is current membership, not historical join attempts.
    SELECT events.id, events.starts_at, events.type, events.place_id
    FROM events JOIN event_participants ON event_participants.event_id = events.id
        JOIN status ON status.id = events.status_id
    WHERE event_participants.user_id = sqlc.arg(user_id) AND events.host_id <> sqlc.arg(user_id)
        AND status.slug <> 'cancelled'
), participation_progress AS (
    SELECT jsonb_build_object(
        'event_goal_target', users.event_goal_target,
        'event_goal_period', users.event_goal_period,
        'goal_progress', CASE users.event_goal_period
            WHEN 'weekly' THEN (SELECT count(*) FROM eligible_signups
                WHERE starts_at >= week_start AND starts_at < week_end)
            WHEN 'monthly' THEN (SELECT count(*) FROM eligible_signups
                WHERE starts_at >= month_start AND starts_at < month_end)
            ELSE 0 END,
        'goal_starts_at', CASE users.event_goal_period WHEN 'weekly' THEN week_start WHEN 'monthly' THEN month_start END,
        'goal_ends_at', CASE users.event_goal_period WHEN 'weekly' THEN week_end WHEN 'monthly' THEN month_end END,
        'eligible_joined', (SELECT count(*) FROM eligible_signups),
        'football_joined', (SELECT count(*) FROM eligible_signups WHERE type = 'football'),
        'cricket_joined', (SELECT count(*) FROM eligible_signups WHERE type = 'cricket'),
        'padel_joined', (SELECT count(*) FROM eligible_signups WHERE type = 'padel'),
        'month_starts_at', month_start, 'month_ends_at', month_end,
        'month_joined', (SELECT count(*) FROM eligible_signups WHERE starts_at >= month_start AND starts_at < month_end),
        'previous_month_joined', (SELECT count(*) FROM eligible_signups WHERE starts_at >= previous_month_start AND starts_at < month_start),
        'month_sports', (SELECT count(DISTINCT type) FROM eligible_signups WHERE starts_at >= month_start AND starts_at < month_end),
        'month_grounds', (SELECT count(DISTINCT place_id) FROM eligible_signups WHERE starts_at >= month_start AND starts_at < month_end),
        'month_hosted', (SELECT count(*) FROM events JOIN status ON status.id = events.status_id
            WHERE events.host_id = users.id AND status.slug <> 'cancelled'
                AND starts_at >= month_start AND starts_at < month_end)
    ) AS progress
    FROM users CROSS JOIN report_periods WHERE users.id = sqlc.arg(user_id)
), join_dates AS (
    -- Current memberships preserve signups from before activity tracking existed.
    SELECT event_id, min(joined_at) AS joined_at
    FROM (
        SELECT trackable_id AS event_id, occurred_at AS joined_at
        FROM activities
        WHERE activities.user_id = sqlc.arg(user_id) AND trackable_type = 'event'
            AND action = 'participation_joined'
        UNION ALL
        SELECT event_id, created_at FROM event_participants
        WHERE event_participants.user_id = sqlc.arg(user_id)
    ) AS signups
    GROUP BY event_id
), personal_events AS (
    SELECT events.id, events.place_id, events.type, status.slug AS status,
        'hosted' AS role, events.created_at AS action_at, false AS left_event
    FROM events JOIN status ON status.id = events.status_id
    WHERE host_id = sqlc.arg(user_id)
    UNION ALL
    SELECT events.id, events.place_id, events.type, status.slug,
        'joined', join_dates.joined_at,
        NOT EXISTS (SELECT 1 FROM event_participants
            WHERE event_id = events.id AND event_participants.user_id = sqlc.arg(user_id))
    FROM join_dates JOIN events ON events.id = join_dates.event_id
        JOIN status ON status.id = events.status_id
    WHERE events.host_id <> sqlc.arg(user_id)
), period_events AS (
    SELECT * FROM personal_events
    WHERE action_at >= sqlc.arg(since)::timestamptz AND action_at < sqlc.arg(until)::timestamptz
), sport_counts AS (
    SELECT type, count(*) FILTER (WHERE role = 'joined') AS joined,
        count(*) FILTER (WHERE role = 'hosted') AS hosted
    FROM period_events GROUP BY type
), ground_counts AS (
    SELECT places.id, places.name, count(*) AS events
    FROM period_events JOIN places ON places.id = period_events.place_id
    GROUP BY places.id, places.name
    ORDER BY events DESC, places.name, places.id LIMIT 3
), history AS (
    SELECT events.id AS entry_id, 'event_created' AS action, events.id AS event_id,
        events.created_at AS occurred_at
    FROM events WHERE host_id = sqlc.arg(user_id)
    UNION ALL
    SELECT activities.id, activities.action::text, activities.trackable_id, activities.occurred_at
    FROM activities JOIN events ON events.id = activities.trackable_id
    WHERE activities.user_id = sqlc.arg(user_id) AND activities.trackable_type = 'event'
        AND (activities.action IN ('participation_joined', 'participation_left')
                AND events.host_id <> sqlc.arg(user_id)
            OR activities.action = 'event_cancelled' AND events.host_id = sqlc.arg(user_id))
    UNION ALL
    SELECT event_participants.event_id, 'participation_joined', event_participants.event_id,
        event_participants.created_at
    FROM event_participants JOIN events ON events.id = event_participants.event_id
    WHERE event_participants.user_id = sqlc.arg(user_id) AND events.host_id <> sqlc.arg(user_id)
        AND NOT EXISTS (SELECT 1 FROM activities
            WHERE activities.user_id = sqlc.arg(user_id) AND trackable_type = 'event'
                AND trackable_id = events.id AND action = 'participation_joined')
), period_history AS (
    SELECT * FROM history
    WHERE occurred_at >= sqlc.arg(since)::timestamptz AND occurred_at < sqlc.arg(until)::timestamptz
), history_page AS (
    SELECT period_history.*, events.title, events.type, places.name AS place_name,
        status.slug AS event_status
    FROM period_history JOIN events ON events.id = event_id
        JOIN places ON places.id = events.place_id JOIN status ON status.id = events.status_id
    ORDER BY occurred_at DESC, entry_id DESC, action
    LIMIT 20 OFFSET sqlc.arg(page_offset)::integer
)
SELECT jsonb_build_object(
    'participation', (SELECT progress FROM participation_progress),
    'joined', (SELECT count(*) FROM period_events WHERE role = 'joined'),
    'left', (SELECT count(*) FROM period_events WHERE role = 'joined' AND left_event),
    'cancelled_joined', (SELECT count(*) FROM period_events WHERE role = 'joined' AND status = 'cancelled'),
    'hosted', (SELECT count(*) FROM period_events WHERE role = 'hosted'),
    'cancelled_hosted', (SELECT count(*) FROM period_events WHERE role = 'hosted' AND status = 'cancelled'),
    'sports', COALESCE((SELECT jsonb_agg(to_jsonb(sport_counts) ORDER BY type) FROM sport_counts), '[]'),
    'grounds', COALESCE((SELECT jsonb_agg(to_jsonb(ground_counts) ORDER BY events DESC, name, id) FROM ground_counts), '[]'),
    'history', COALESCE((SELECT jsonb_agg(to_jsonb(history_page) ORDER BY occurred_at DESC, entry_id DESC, action) FROM history_page), '[]'),
    'next_offset', CASE WHEN (SELECT count(*) FROM period_history) > sqlc.arg(page_offset)::integer + 20
        THEN sqlc.arg(page_offset)::integer + 20 ELSE NULL END
)::jsonb AS activity;
