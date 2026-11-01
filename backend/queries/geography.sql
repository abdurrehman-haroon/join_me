-- name: ListCityDistricts :one
-- Counts only scheduled events between now and window_ends_at, so the explore
-- feed describes what is coming up rather than every future event.
WITH city AS (
    SELECT * FROM areas
    WHERE areas.type = 'city' AND areas.parent_id IS NULL AND areas.slug = sqlc.arg(city_slug)
), upcoming_events AS (
    SELECT events.id, events.title, events.starts_at, events.place_id, places.area_id AS district_id
    FROM events
    JOIN places ON places.id = events.place_id
    JOIN status ON status.id = events.status_id
    WHERE status.statusable_type = 'event' AND status.slug = 'scheduled'
        AND events.starts_at > statement_timestamp()
        AND events.starts_at < sqlc.arg(window_ends_at)::timestamptz
), district_summaries AS (
    SELECT districts.id, districts.name, districts.slug, districts.sort_order, districts.boundary,
        COALESCE(districts.boundary, (
            SELECT ST_Expand(ST_Extent(places.location)::geometry, 0.001)
            FROM places WHERE places.area_id = districts.id
        )) AS view_boundary,
        (SELECT count(*) FROM places WHERE places.area_id = districts.id) AS place_count,
        (SELECT count(*) FROM upcoming_events WHERE upcoming_events.district_id = districts.id) AS upcoming_event_count,
        (SELECT jsonb_build_object(
            'place', jsonb_build_object('id', places.id, 'name', places.name, 'slug', places.slug),
            'event', jsonb_build_object('id', upcoming_events.id, 'title', upcoming_events.title,
                'starts_at', upcoming_events.starts_at))
         FROM upcoming_events JOIN places ON places.id = upcoming_events.place_id
         WHERE upcoming_events.district_id = districts.id
         ORDER BY upcoming_events.starts_at, upcoming_events.id
         LIMIT 1) AS first_up
    FROM areas AS districts
    JOIN city ON districts.parent_id = city.id
    WHERE districts.type = 'district'
), city_view AS (
    SELECT city.*, COALESCE(city.boundary, (
        SELECT ST_Expand(ST_Extent(places.location)::geometry, 0.001)
        FROM places JOIN areas AS districts ON districts.id = places.area_id
        WHERE districts.parent_id = city.id
    )) AS view_boundary
    FROM city
)
SELECT jsonb_build_object(
    'city', jsonb_build_object('id', city_view.id, 'name', city_view.name, 'slug', city_view.slug,
        'bbox', CASE WHEN city_view.view_boundary IS NOT NULL THEN jsonb_build_array(
            ST_XMin(Box3D(city_view.view_boundary)), ST_YMin(Box3D(city_view.view_boundary)),
            ST_XMax(Box3D(city_view.view_boundary)), ST_YMax(Box3D(city_view.view_boundary))) ELSE NULL END),
    'window_ends_at', sqlc.arg(window_ends_at)::timestamptz,
    'districts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', district_summaries.id, 'name', district_summaries.name,
        'slug', district_summaries.slug, 'sort_order', district_summaries.sort_order,
        'boundary', ST_AsGeoJSON(district_summaries.boundary)::jsonb,
        'bbox', CASE WHEN district_summaries.view_boundary IS NOT NULL THEN jsonb_build_array(
            ST_XMin(Box3D(district_summaries.view_boundary)), ST_YMin(Box3D(district_summaries.view_boundary)),
            ST_XMax(Box3D(district_summaries.view_boundary)), ST_YMax(Box3D(district_summaries.view_boundary))) ELSE NULL END,
        'place_count', district_summaries.place_count,
        'upcoming_event_count', district_summaries.upcoming_event_count,
        'first_up', district_summaries.first_up
    ) ORDER BY district_summaries.sort_order, district_summaries.name, district_summaries.id)
    FROM district_summaries), '[]'::jsonb)
)::jsonb AS districts
FROM city_view;

-- name: ListDistrictPlaces :one
-- Each place carries at most 20 upcoming events for its carousel;
-- upcoming_event_count stays exact.
WITH district AS (
    SELECT districts.*, city.id AS city_id, city.name AS city_name, city.slug AS city_slug
    FROM areas AS districts
    JOIN areas AS city ON city.id = districts.parent_id
    WHERE city.type = 'city' AND city.slug = sqlc.arg(city_slug)
        AND districts.type = 'district' AND districts.slug = sqlc.arg(district_slug)
), upcoming_events AS (
    SELECT events.*, place_spots.name AS spot_name, place_spots.location AS spot_location,
        users.display_name AS host_name, status.name AS status_name, status.slug AS status_slug,
        (SELECT count(*) FROM event_participants WHERE event_id = events.id) AS participant_count,
        row_number() OVER (PARTITION BY events.place_id ORDER BY events.starts_at, events.id) AS place_position
    FROM events
    JOIN places ON places.id = events.place_id
    JOIN district ON district.id = places.area_id
    LEFT JOIN place_spots ON place_spots.id = events.spot_id
    JOIN users ON users.id = events.host_id
    JOIN status ON status.id = events.status_id
    WHERE status.statusable_type = 'event' AND status.slug = 'scheduled'
        AND events.starts_at > statement_timestamp()
        AND events.starts_at < sqlc.arg(window_ends_at)::timestamptz
), place_summaries AS (
    SELECT places.id, places.name, places.slug, places.type, places.location, places.sort_order,
        (SELECT count(*) FROM upcoming_events WHERE upcoming_events.place_id = places.id) AS upcoming_event_count,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', upcoming_events.id, 'title', upcoming_events.title, 'type', upcoming_events.type,
            'starts_at', upcoming_events.starts_at, 'capacity', upcoming_events.capacity,
            'host', jsonb_build_object('id', upcoming_events.host_id, 'display_name', upcoming_events.host_name),
            'place', jsonb_build_object('id', places.id, 'name', places.name,
                'coordinates', ST_AsGeoJSON(places.location)::jsonb->'coordinates'),
            'spot', CASE WHEN upcoming_events.spot_id IS NULL THEN NULL ELSE jsonb_build_object(
                'id', upcoming_events.spot_id, 'name', upcoming_events.spot_name,
                'coordinates', ST_AsGeoJSON(upcoming_events.spot_location)::jsonb->'coordinates') END,
            'status', jsonb_build_object('id', upcoming_events.status_id,
                'name', upcoming_events.status_name, 'slug', upcoming_events.status_slug),
            'participant_count', upcoming_events.participant_count,
            'available_spots', GREATEST(upcoming_events.capacity - upcoming_events.participant_count, 0),
            'is_full', upcoming_events.participant_count >= upcoming_events.capacity,
            'created_at', upcoming_events.created_at, 'updated_at', upcoming_events.updated_at
        ) ORDER BY upcoming_events.starts_at, upcoming_events.id)
        FROM upcoming_events
        WHERE upcoming_events.place_id = places.id AND upcoming_events.place_position <= 20), '[]'::jsonb) AS events
    FROM places
    JOIN district ON district.id = places.area_id
), district_view AS (
    SELECT district.*, COALESCE(district.boundary, (
        SELECT ST_Expand(ST_Extent(places.location)::geometry, 0.001)
        FROM places WHERE places.area_id = district.id
    )) AS view_boundary
    FROM district
)
SELECT jsonb_build_object(
    'district', jsonb_build_object('id', district_view.id, 'name', district_view.name, 'slug', district_view.slug,
        'boundary', ST_AsGeoJSON(district_view.boundary)::jsonb,
        'city', jsonb_build_object('id', district_view.city_id, 'name', district_view.city_name, 'slug', district_view.city_slug),
        'bbox', CASE WHEN district_view.view_boundary IS NOT NULL THEN jsonb_build_array(
            ST_XMin(Box3D(district_view.view_boundary)), ST_YMin(Box3D(district_view.view_boundary)),
            ST_XMax(Box3D(district_view.view_boundary)), ST_YMax(Box3D(district_view.view_boundary))) ELSE NULL END),
    'window_ends_at', sqlc.arg(window_ends_at)::timestamptz,
    'places', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', place_summaries.id, 'name', place_summaries.name, 'slug', place_summaries.slug,
        'type', place_summaries.type, 'sort_order', place_summaries.sort_order,
        'coordinates', ST_AsGeoJSON(place_summaries.location)::jsonb->'coordinates',
        'upcoming_event_count', place_summaries.upcoming_event_count, 'events', place_summaries.events
    ) ORDER BY place_summaries.sort_order, place_summaries.name, place_summaries.id)
    FROM place_summaries), '[]'::jsonb)
)::jsonb AS places
FROM district_view;

-- name: GetPlaceBySlugs :one
-- Returns at most 100 upcoming events; truncated reports when more exist.
WITH place AS (
    SELECT places.*, districts.name AS district_name, districts.slug AS district_slug,
        city.id AS city_id, city.name AS city_name, city.slug AS city_slug
    FROM places
    JOIN areas AS districts ON districts.id = places.area_id
    JOIN areas AS city ON city.id = districts.parent_id
    WHERE city.type = 'city' AND city.slug = sqlc.arg(city_slug)
        AND districts.type = 'district' AND districts.slug = sqlc.arg(district_slug)
        AND places.slug = sqlc.arg(place_slug)
), upcoming_events AS (
    SELECT events.*, place_spots.name AS spot_name, place_spots.location AS spot_location,
        users.display_name AS host_name, status.name AS status_name, status.slug AS status_slug,
        (SELECT count(*) FROM event_participants WHERE event_id = events.id) AS participant_count,
        row_number() OVER (ORDER BY events.starts_at, events.id) AS position
    FROM events
    JOIN place ON place.id = events.place_id
    LEFT JOIN place_spots ON place_spots.id = events.spot_id
    JOIN users ON users.id = events.host_id
    JOIN status ON status.id = events.status_id
    WHERE status.statusable_type = 'event' AND status.slug = 'scheduled'
        AND events.starts_at > statement_timestamp()
        AND events.starts_at < sqlc.arg(window_ends_at)::timestamptz
)
SELECT jsonb_build_object(
    'place', jsonb_build_object('id', place.id, 'name', place.name, 'slug', place.slug, 'type', place.type,
        'coordinates', ST_AsGeoJSON(place.location)::jsonb->'coordinates',
        'boundary', ST_AsGeoJSON(place.boundary)::jsonb,
        'district', jsonb_build_object('id', place.area_id, 'name', place.district_name, 'slug', place.district_slug),
        'city', jsonb_build_object('id', place.city_id, 'name', place.city_name, 'slug', place.city_slug)),
    'spots', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', place_spots.id, 'name', place_spots.name, 'slug', place_spots.slug, 'type', place_spots.type,
        'coordinates', ST_AsGeoJSON(place_spots.location)::jsonb->'coordinates',
        'boundary', ST_AsGeoJSON(place_spots.boundary)::jsonb
    ) ORDER BY place_spots.sort_order, place_spots.name, place_spots.id)
    FROM place_spots WHERE place_spots.place_id = place.id), '[]'::jsonb),
    'window_ends_at', sqlc.arg(window_ends_at)::timestamptz,
    'truncated', (SELECT count(*) > 100 FROM upcoming_events),
    'events', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', upcoming_events.id, 'title', upcoming_events.title, 'type', upcoming_events.type,
        'starts_at', upcoming_events.starts_at, 'capacity', upcoming_events.capacity,
        'host', jsonb_build_object('id', upcoming_events.host_id, 'display_name', upcoming_events.host_name),
        'place', jsonb_build_object('id', place.id, 'name', place.name,
            'coordinates', ST_AsGeoJSON(place.location)::jsonb->'coordinates'),
        'spot', CASE WHEN upcoming_events.spot_id IS NULL THEN NULL ELSE jsonb_build_object(
            'id', upcoming_events.spot_id, 'name', upcoming_events.spot_name,
            'coordinates', ST_AsGeoJSON(upcoming_events.spot_location)::jsonb->'coordinates') END,
        'status', jsonb_build_object('id', upcoming_events.status_id,
            'name', upcoming_events.status_name, 'slug', upcoming_events.status_slug),
        'participant_count', upcoming_events.participant_count,
        'available_spots', GREATEST(upcoming_events.capacity - upcoming_events.participant_count, 0),
        'is_full', upcoming_events.participant_count >= upcoming_events.capacity,
        'created_at', upcoming_events.created_at, 'updated_at', upcoming_events.updated_at
    ) ORDER BY upcoming_events.starts_at, upcoming_events.id)
    FROM upcoming_events WHERE upcoming_events.position <= 100), '[]'::jsonb)
)::jsonb AS place
FROM place;
