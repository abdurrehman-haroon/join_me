-- Internal report: run against the intended environment, excluding development/demo data.
-- psql "$DATABASE_URL" -v from='2026-10-18T00:00:00Z' -v until='2026-10-19T00:00:00Z' -f reports/activities.sql
-- Half-open cohort window [from, until); 24 hours of follow-up. Report timezone is UTC.
SET TIME ZONE 'UTC';
WITH starts AS (
    SELECT * FROM activities
    WHERE occurred_at >= :'from'::timestamptz AND occurred_at < :'until'::timestamptz
        AND (action = 'event_creation_started'
            OR (action = 'event_viewed' AND details->>'viewer_role' = 'visitor'))
), cohorts AS (
    SELECT starts.*,
        CASE WHEN action = 'event_creation_started' THEN 'creation' ELSE 'view_to_join' END AS flow,
        EXISTS (
            SELECT 1 FROM activities AS outcome
            WHERE outcome.interaction_id = starts.interaction_id
                AND outcome.session_id = starts.session_id AND outcome.user_id = starts.user_id
                AND outcome.action = CASE WHEN starts.action = 'event_creation_started'
                    THEN 'event_created'::activity_action ELSE 'participation_joined'::activity_action END
                AND (starts.action = 'event_creation_started' OR outcome.trackable_id = starts.trackable_id)
                -- Client clocks have five minutes of accepted skew; durations below use client timers.
                AND outcome.occurred_at >= starts.occurred_at - interval '5 minutes'
                AND outcome.occurred_at <= starts.occurred_at + interval '24 hours'
        ) AS confirmed,
        starts.occurred_at <= statement_timestamp() - interval '24 hours' AS mature
    FROM starts
)
SELECT flow, count(*) AS started,
    count(*) FILTER (WHERE confirmed) AS confirmed,
    count(*) FILTER (WHERE NOT confirmed AND NOT mature) AS pending_followup,
    count(*) FILTER (WHERE NOT confirmed AND mature) AS no_confirmed_completion,
    count(*) FILTER (WHERE mature) AS mature_started,
    round(count(*) FILTER (WHERE mature AND confirmed)::numeric /
        NULLIF(count(*) FILTER (WHERE mature), 0), 4) AS mature_conversion
FROM cohorts GROUP BY flow ORDER BY flow;

-- Duration report: first submitted attempt per interaction, independent of backend/network time.
WITH starts AS (
    SELECT * FROM activities
    WHERE occurred_at >= :'from'::timestamptz AND occurred_at < :'until'::timestamptz
        AND (action = 'event_creation_started'
            OR (action = 'event_viewed' AND details->>'viewer_role' = 'visitor'))
), submissions AS (
    SELECT DISTINCT ON (starts.id) submission.*, starts.occurred_at AS interaction_started_at
    FROM starts JOIN activities AS submission ON submission.interaction_id = starts.interaction_id
        AND submission.user_id = starts.user_id AND submission.session_id = starts.session_id
        AND submission.trackable_id = starts.trackable_id
        AND submission.action = CASE WHEN starts.action = 'event_creation_started'
            THEN 'event_creation_submitted'::activity_action ELSE 'join_attempted'::activity_action END
    ORDER BY starts.id, submission.interaction_step
), measured AS (
    SELECT submissions.*, EXISTS (
        SELECT 1 FROM activities AS outcome
        WHERE outcome.interaction_id = submissions.interaction_id
            AND outcome.user_id = submissions.user_id AND outcome.session_id = submissions.session_id
            AND outcome.action = CASE WHEN submissions.action = 'event_creation_submitted'
                THEN 'event_created'::activity_action ELSE 'participation_joined'::activity_action END
            AND (submissions.action = 'event_creation_submitted' OR outcome.trackable_id = submissions.trackable_id)
            AND outcome.occurred_at >= submissions.interaction_started_at - interval '5 minutes'
            AND outcome.occurred_at <= submissions.interaction_started_at + interval '24 hours'
    ) AS confirmed
    FROM submissions
)
SELECT action, confirmed, count(*) AS interactions,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY (details->>'elapsed_ms')::bigint) AS elapsed_p50_ms,
    percentile_cont(0.9) WITHIN GROUP (ORDER BY (details->>'elapsed_ms')::bigint) AS elapsed_p90_ms,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY (details->>'active_ms')::bigint) AS active_p50_ms,
    percentile_cont(0.9) WITHIN GROUP (ORDER BY (details->>'active_ms')::bigint) AS active_p90_ms
FROM measured GROUP BY action, confirmed ORDER BY action, confirmed;

-- Timeline. Reorder late deliveries by frontend step; backend outcomes have no fabricated step.
-- Add WHERE interaction_id = '<uuid>' to inspect one attempt.
SELECT interaction_id, interaction_step, action, occurred_at, created_at,
    details->>'elapsed_ms' AS elapsed_ms, details->>'active_ms' AS active_ms,
    CASE WHEN interaction_step IS NOT NULL THEN interaction_step !=
        COALESCE(lag(interaction_step) OVER (PARTITION BY interaction_id ORDER BY interaction_step NULLS LAST), 0) + 1 END AS missing_previous_step,
    details
FROM activities
WHERE occurred_at >= :'from'::timestamptz AND occurred_at < :'until'::timestamptz
ORDER BY interaction_id, interaction_step NULLS LAST, occurred_at, id;

-- Coverage warning: backend successes without an observed matching client start.
SELECT outcome.action, count(*) AS unmatched_outcomes
FROM activities AS outcome
WHERE outcome.action IN ('event_created', 'participation_joined')
    AND outcome.occurred_at >= :'from'::timestamptz AND outcome.occurred_at < :'until'::timestamptz
    AND NOT EXISTS (
        SELECT 1 FROM activities AS start
        WHERE start.interaction_id = outcome.interaction_id
            AND start.session_id = outcome.session_id AND start.user_id = outcome.user_id
            AND start.action = CASE WHEN outcome.action = 'event_created'
                THEN 'event_creation_started'::activity_action ELSE 'event_viewed'::activity_action END
    )
GROUP BY outcome.action;
