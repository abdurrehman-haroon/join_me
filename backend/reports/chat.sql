-- Internal chat engagement report. No message content or names are selected.
-- psql "$DATABASE_URL" -v from='2026-10-19T00:00:00Z' -v until='2026-10-20T00:00:00Z' -f reports/chat.sql
SET TIME ZONE 'UTC';

-- Each actual non-host join has at most 24 hours of follow-up, ending on leave/rejoin.
-- Opens may arrive late; client-clock skew can affect attribution near membership
-- boundaries. Messages are server-confirmed outcomes inside the membership window.
WITH joins AS (
    SELECT joined.*,
        LEAST(joined.occurred_at + interval '24 hours', COALESCE((
            SELECT min(next_membership.occurred_at) FROM activities AS next_membership
            WHERE next_membership.trackable_id = joined.trackable_id
                AND next_membership.user_id = joined.user_id
                AND next_membership.action IN ('participation_left', 'participation_joined')
                AND next_membership.occurred_at > joined.occurred_at
        ), joined.occurred_at + interval '24 hours')) AS followup_until
    FROM activities AS joined
    WHERE joined.action = 'participation_joined'
        AND joined.occurred_at >= :'from'::timestamptz AND joined.occurred_at < :'until'::timestamptz
), outcomes AS (
    SELECT joins.*,
        EXISTS (
            SELECT 1 FROM activities AS opened
            WHERE opened.action = 'chat_opened' AND opened.user_id = joins.user_id
                AND opened.trackable_id = joins.trackable_id
                AND opened.occurred_at >= joins.occurred_at
                AND opened.occurred_at < joins.followup_until
        ) AS opened_chat,
        EXISTS (
            SELECT 1 FROM activities AS sent
            WHERE sent.action = 'message_sent' AND sent.user_id = joins.user_id
                AND sent.trackable_id = joins.trackable_id
                AND sent.occurred_at >= joins.occurred_at AND sent.occurred_at < joins.followup_until
        ) AS sent_message
    FROM joins
)
SELECT count(*) AS joined_memberships,
    count(*) FILTER (WHERE opened_chat) AS memberships_opening_chat,
    count(*) FILTER (WHERE sent_message) AS memberships_sending_message,
    count(*) FILTER (WHERE opened_chat AND sent_message) AS memberships_opening_and_sending,
    count(*) FILTER (WHERE followup_until <= statement_timestamp()) AS complete_followups,
    count(*) FILTER (WHERE followup_until > statement_timestamp()) AS pending_followups
FROM outcomes;

-- Explicit chat interaction + actor + session + event attribute the first message
-- to a visit. Reopening produces another visit; retries do not add messages.
WITH visits AS (
    SELECT opened.*, EXISTS (
        SELECT 1 FROM activities AS sent
        WHERE sent.action = 'message_sent'
            AND sent.interaction_id = opened.interaction_id
            AND sent.user_id = opened.user_id AND sent.session_id = opened.session_id
            AND sent.trackable_id = opened.trackable_id
            AND sent.occurred_at >= opened.occurred_at - interval '5 minutes'
            AND sent.occurred_at <= opened.occurred_at + interval '24 hours'
    ) AS messaged
    FROM activities AS opened
    WHERE opened.action = 'chat_opened'
        AND opened.occurred_at >= :'from'::timestamptz AND opened.occurred_at < :'until'::timestamptz
)
SELECT count(*) AS chat_visits, count(*) FILTER (WHERE messaged) AS visits_with_message,
    count(*) FILTER (WHERE occurred_at <= statement_timestamp() - interval '24 hours') AS mature_visits,
    round(count(*) FILTER (WHERE messaged AND occurred_at <= statement_timestamp() - interval '24 hours')::numeric /
        NULLIF(count(*) FILTER (WHERE occurred_at <= statement_timestamp() - interval '24 hours'), 0), 4) AS mature_message_conversion
FROM visits;

-- Message traffic is backend-confirmed; absent client starts are incomplete observation.
SELECT count(*) AS messages_sent,
    count(*) FILTER (WHERE NOT EXISTS (
        SELECT 1 FROM activities AS opened
        WHERE opened.action = 'chat_opened' AND opened.interaction_id = sent.interaction_id
            AND opened.user_id = sent.user_id AND opened.session_id = sent.session_id
            AND opened.trackable_id = sent.trackable_id
            AND sent.occurred_at >= opened.occurred_at - interval '5 minutes'
            AND sent.occurred_at <= opened.occurred_at + interval '24 hours'
    )) AS messages_without_observed_visit
FROM activities AS sent
WHERE sent.action = 'message_sent'
    AND sent.occurred_at >= :'from'::timestamptz AND sent.occurred_at < :'until'::timestamptz;
