-- Internal hosting report. Snapshots include the host in participant_count.
-- psql "$DATABASE_URL" -v from='2026-10-18T00:00:00Z' -v until='2026-10-19T00:00:00Z' -f reports/hosting.sql
SET TIME ZONE 'UTC';

SELECT count(*) AS edits, count(DISTINCT trackable_id) AS events_edited,
    count(*) FILTER (WHERE details->'changes' ? 'title') AS title_edits,
    count(*) FILTER (WHERE details->'changes' ? 'capacity') AS capacity_edits,
    count(*) FILTER (WHERE details->'changes' ? 'starts_at') AS reschedules
FROM activities
WHERE action = 'event_edited'
    AND occurred_at >= :'from'::timestamptz AND occurred_at < :'until'::timestamptz;

-- Count transitions into full, rather than every later action on a full event.
WITH transitions AS (
    SELECT action, details,
        (details->'snapshot'->>'participant_count')::integer AS participants,
        (details->'snapshot'->>'capacity')::integer AS capacity
    FROM activities
    WHERE action IN ('participation_joined', 'event_edited')
        AND occurred_at >= :'from'::timestamptz AND occurred_at < :'until'::timestamptz
)
SELECT CASE WHEN action = 'participation_joined' THEN 'join' ELSE 'capacity_reduction' END AS full_cause,
    count(*) AS transitions_to_full
FROM transitions
WHERE participants = capacity AND (
    action = 'participation_joined'
    OR (details->'changes'->'capacity'->>'before')::integer > participants
)
GROUP BY full_cause ORDER BY full_cause;

-- The recorded kickoff and roster survive later changes to the event itself.
WITH cancellations AS (
    SELECT details->>'previous_status' AS previous_status,
        extract(epoch FROM (details->'snapshot'->>'starts_at')::timestamptz - occurred_at) AS seconds_before_start,
        (details->'snapshot'->>'participant_count')::integer AS participants
    FROM activities
    WHERE action = 'event_cancelled'
        AND occurred_at >= :'from'::timestamptz AND occurred_at < :'until'::timestamptz
)
SELECT previous_status, count(*) AS cancellations,
    count(*) FILTER (WHERE seconds_before_start < 3600) AS within_one_hour,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds_before_start) AS lead_p50_seconds,
    sum(participants) AS affected_memberships
FROM cancellations GROUP BY previous_status ORDER BY previous_status;

-- Observed membership changes after rescheduling are correlation, not proof of cause.
-- Stop at the next reschedule/cancellation or after 24 hours; recent windows are provisional.
WITH reschedules AS (
    SELECT edit.id, edit.trackable_id, edit.occurred_at,
        LEAST(edit.occurred_at + interval '24 hours', COALESCE((
            SELECT min(next_change.occurred_at) FROM activities AS next_change
            WHERE next_change.trackable_id = edit.trackable_id
                AND next_change.occurred_at > edit.occurred_at
                AND (next_change.action = 'event_cancelled'
                    OR (next_change.action = 'event_edited' AND next_change.details->'changes' ? 'starts_at'))
        ), edit.occurred_at + interval '24 hours')) AS followup_until
    FROM activities AS edit
    WHERE edit.action = 'event_edited' AND edit.details->'changes' ? 'starts_at'
        AND edit.occurred_at >= :'from'::timestamptz AND edit.occurred_at < :'until'::timestamptz
)
SELECT reschedules.id AS edit_activity_id, reschedules.trackable_id AS event_id,
    reschedules.followup_until <= statement_timestamp() AS followup_complete,
    count(outcome.id) FILTER (WHERE outcome.action = 'participation_joined') AS joins_after,
    count(outcome.id) FILTER (WHERE outcome.action = 'participation_left') AS leaves_after
FROM reschedules LEFT JOIN activities AS outcome
    ON outcome.trackable_id = reschedules.trackable_id
    AND outcome.action IN ('participation_joined', 'participation_left')
    AND outcome.occurred_at > reschedules.occurred_at
    AND outcome.occurred_at < reschedules.followup_until
GROUP BY reschedules.id, reschedules.trackable_id, reschedules.followup_until
ORDER BY reschedules.id;
