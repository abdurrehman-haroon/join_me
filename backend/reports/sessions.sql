-- Internal app-visit report. A session is a process visit, not a distinct person.
-- psql "$DATABASE_URL" -v from='2026-10-19T00:00:00Z' -v until='2026-10-20T00:00:00Z' -f reports/sessions.sql
SET TIME ZONE 'UTC';

SELECT date_trunc('day', occurred_at) AS started_day,
    count(*) AS sessions_started, count(DISTINCT user_id) AS recorded_actor_ids
FROM activities
WHERE action = 'session_started'
    AND occurred_at >= :'from'::timestamptz AND occurred_at < :'until'::timestamptz
GROUP BY started_day ORDER BY started_day;

-- Cohort by start time; include later observed actions in the same actor/session.
-- There is no inferred end or duration. Old clients and dropped starts are absent
-- from this cohort, and later queued delivery can change the observed counts.
WITH starts AS (
    SELECT * FROM activities
    WHERE action = 'session_started'
        AND occurred_at >= :'from'::timestamptz AND occurred_at < :'until'::timestamptz
)
SELECT starts.session_id, starts.occurred_at AS started_at,
    count(observed.id) AS observed_activity_rows,
    count(observed.id) FILTER (WHERE observed.action = 'place_viewed') AS place_views,
    count(observed.id) FILTER (WHERE observed.action = 'event_viewed') AS event_views,
    count(observed.id) FILTER (WHERE observed.action = 'event_created') AS events_created,
    count(observed.id) FILTER (WHERE observed.action = 'participation_joined') AS joins,
    count(observed.id) FILTER (WHERE observed.action = 'chat_opened') AS chat_visits,
    count(observed.id) FILTER (WHERE observed.action = 'message_sent') AS messages_sent
FROM starts LEFT JOIN activities AS observed
    ON observed.session_id = starts.session_id AND observed.user_id = starts.user_id
    AND observed.action != 'session_started'
GROUP BY starts.id, starts.session_id, starts.occurred_at ORDER BY started_at, starts.session_id;
