-- Internal discovery report. No coordinates or user names are selected.
-- psql "$DATABASE_URL" -v from='2026-10-18T00:00:00Z' -v until='2026-10-19T00:00:00Z' -f reports/discovery.sql
SET TIME ZONE 'UTC';

-- "place_openings" uses the filter when that place visit began, not the game's sport.
SELECT details->>'sport' AS selected_filter,
    count(*) FILTER (WHERE action = 'sport_filter_selected') AS filter_changes,
    count(*) FILTER (WHERE action = 'place_viewed') AS place_openings,
    count(*) FILTER (WHERE action = 'empty_results_viewed' AND source = 'map' AND details->>'empty_kind' = 'no_events') AS map_no_events,
    count(*) FILTER (WHERE action = 'empty_results_viewed' AND source = 'map' AND details->>'empty_kind' = 'no_places') AS map_no_places,
    count(*) FILTER (WHERE action = 'empty_results_viewed' AND source = 'place_details') AS place_no_events
FROM activities
WHERE occurred_at >= :'from'::timestamptz AND occurred_at < :'until'::timestamptz
    AND action IN ('sport_filter_selected', 'place_viewed', 'empty_results_viewed')
GROUP BY details->>'sport' ORDER BY selected_filter;

-- Explicit referrers connect a place visit to event views; session membership alone is not attribution.
-- Outcomes have 24 hours of follow-up; recent cohorts are still provisional.
WITH place_visits AS (
    SELECT * FROM activities
    WHERE action = 'place_viewed'
        AND occurred_at >= :'from'::timestamptz AND occurred_at < :'until'::timestamptz
), event_views AS (
    SELECT * FROM activities
    WHERE action = 'event_viewed' AND source = 'place_details'
        AND occurred_at >= :'from'::timestamptz - interval '5 minutes'
        AND occurred_at < :'until'::timestamptz + interval '24 hours'
), linked_views AS (
    SELECT place_visits.id AS place_visit_id, event_views.*,
        EXISTS (
            SELECT 1 FROM activities AS outcome
            WHERE outcome.action = 'participation_joined'
                AND outcome.interaction_id = event_views.interaction_id
                AND outcome.user_id = event_views.user_id AND outcome.session_id = event_views.session_id
                AND outcome.trackable_id = event_views.trackable_id
                AND outcome.occurred_at >= event_views.occurred_at - interval '5 minutes'
                AND outcome.occurred_at <= event_views.occurred_at + interval '24 hours'
        ) AS joined
    FROM place_visits JOIN event_views
        ON (event_views.details->>'referrer_interaction_id')::uuid = place_visits.interaction_id
        AND event_views.user_id = place_visits.user_id AND event_views.session_id = place_visits.session_id
        AND event_views.occurred_at >= place_visits.occurred_at - interval '5 minutes'
        AND event_views.occurred_at <= place_visits.occurred_at + interval '24 hours'
    JOIN events ON events.id = event_views.trackable_id AND events.place_id = place_visits.trackable_id
)
SELECT place_visits.trackable_id AS place_id, places.name,
    count(DISTINCT place_visits.id) AS place_visits,
    count(DISTINCT place_visits.id) FILTER (WHERE place_visits.occurred_at <= statement_timestamp() - interval '24 hours') AS mature_place_visits,
    count(DISTINCT linked_views.place_visit_id) AS visits_opening_events,
    count(linked_views.id) FILTER (WHERE linked_views.details->>'viewer_role' = 'visitor') AS visitor_event_views,
    count(linked_views.id) FILTER (WHERE linked_views.details->>'viewer_role' = 'visitor' AND linked_views.joined) AS views_with_confirmed_join
FROM place_visits JOIN places ON places.id = place_visits.trackable_id
LEFT JOIN linked_views ON linked_views.place_visit_id = place_visits.id
GROUP BY place_visits.trackable_id, places.name ORDER BY place_visits DESC, place_id;
