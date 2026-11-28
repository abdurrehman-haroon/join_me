-- name: SearchPlaces :one
-- The create flow's place search across all of a city. Ranking: the place's name
-- starts with the query, then any of its names contains it, then trigram
-- similarity of at least 0.3 to the shown name or to all names together
-- (closest match first). Within a tier, nearer first
-- when the client sends where it is; that point is used for sorting only.
WITH query AS (
    SELECT lower(btrim(sqlc.arg(query)::text)) AS text
), pattern AS (
    -- LIKE treats % and _ as wildcards; match them literally.
    SELECT text, replace(replace(replace(text, '\', '\\'), '%', '\%'), '_', '\_') AS literal
    FROM query
), near AS (
    SELECT CASE WHEN sqlc.narg(near_lng)::float8 IS NULL THEN NULL
        ELSE ST_SetSRID(ST_MakePoint(sqlc.narg(near_lng)::float8, sqlc.narg(near_lat)::float8), 4326)::geography END AS point
), matches AS (
    SELECT places.id, places.slug, places.name, places.type, places.kind_text, places.location,
        places.created_by IS NOT NULL AS private,
        district.slug AS district_slug, district.name AS district_name,
        CASE
            WHEN lower(places.name) LIKE pattern.literal || '%' THEN 1
            WHEN places.search_text LIKE '%' || pattern.literal || '%' THEN 2
            ELSE 3
        END AS tier,
        GREATEST(similarity(lower(places.name), pattern.text), similarity(places.search_text, pattern.text)) AS score,
        ST_Distance(places.location::geography, near.point) AS distance_m
    FROM places
    JOIN areas AS district ON district.id = places.area_id
    JOIN areas AS city ON city.id = district.parent_id
    CROSS JOIN pattern
    CROSS JOIN near
    WHERE city.type = 'city' AND city.slug = sqlc.arg(city_slug)
        AND places.status = 'active'
        -- Private places, and rejected ones (which become private), only for their creator.
        AND (places.created_by IS NULL AND places.review_status <> 'rejected'
            OR places.created_by = sqlc.narg(viewer_id)::uuid)
        AND (places.search_text LIKE '%' || pattern.literal || '%'
            OR lower(places.name) % pattern.text OR places.search_text % pattern.text)
), ranked AS (
    SELECT matches.*, (SELECT count(*) FROM matches) AS total
    FROM matches
    ORDER BY tier, CASE WHEN tier = 3 THEN -score END, distance_m NULLS LAST, name, id
    LIMIT sqlc.arg(result_limit)::int
)
SELECT jsonb_build_object(
    'result_count', COALESCE((SELECT max(total) FROM ranked), 0),
    'places', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', ranked.id, 'slug', ranked.slug, 'name', ranked.name, 'type', ranked.type,
        'kind_text', ranked.kind_text, 'private', ranked.private,
        'district', jsonb_build_object('slug', ranked.district_slug, 'name', ranked.district_name),
        'coordinates', jsonb_build_array(round(ST_X(ranked.location)::numeric, 6), round(ST_Y(ranked.location)::numeric, 6)),
        'distance_m', round(ranked.distance_m)
    ) ORDER BY ranked.tier, CASE WHEN ranked.tier = 3 THEN -ranked.score END, ranked.distance_m NULLS LAST, ranked.name, ranked.id)
    FROM ranked), '[]'::jsonb)
)::jsonb AS results;

-- name: ListPickerPlaces :one
-- Every place the picker can show, downloaded once and filtered on the phone.
-- Rows are compact arrays (see "fields") to keep the download small.
WITH upcoming AS (
    SELECT events.place_id, count(*) AS events
    FROM events
    JOIN status ON status.id = events.status_id
    WHERE status.statusable_type = 'event' AND status.slug = 'scheduled'
        AND events.starts_at > statement_timestamp()
        AND events.starts_at < sqlc.arg(window_ends_at)::timestamptz
    GROUP BY events.place_id
), city_places AS (
    SELECT places.*, district.slug AS district_slug, COALESCE(upcoming.events, 0) AS upcoming_event_count
    FROM places
    JOIN areas AS district ON district.id = places.area_id
    JOIN areas AS city ON city.id = district.parent_id
    LEFT JOIN upcoming ON upcoming.place_id = places.id
    WHERE city.type = 'city' AND city.slug = sqlc.arg(city_slug)
        AND places.status = 'active'
        -- Private places, and rejected ones (which become private), only for their creator.
        AND (places.created_by IS NULL AND places.review_status <> 'rejected'
            OR places.created_by = sqlc.narg(viewer_id)::uuid)
)
SELECT jsonb_build_object(
    'window_ends_at', sqlc.arg(window_ends_at)::timestamptz,
    'fields', jsonb_build_array('id', 'slug', 'name', 'type', 'district_slug', 'longitude', 'latitude', 'upcoming_event_count',
        'kind_text', 'private'),
    -- District names by slug, so rows carry only the slug.
    'districts', COALESCE((SELECT jsonb_object_agg(district.slug, district.name)
        FROM areas AS district JOIN areas AS city ON city.id = district.parent_id
        WHERE city.type = 'city' AND city.slug = sqlc.arg(city_slug) AND district.type = 'district'), '{}'::jsonb),
    'places', COALESCE((SELECT jsonb_agg(jsonb_build_array(
        city_places.id, city_places.slug, city_places.name, city_places.type, city_places.district_slug,
        round(ST_X(city_places.location)::numeric, 5), round(ST_Y(city_places.location)::numeric, 5),
        city_places.upcoming_event_count, city_places.kind_text, city_places.created_by IS NOT NULL
    ) ORDER BY city_places.name, city_places.id) FROM city_places), '[]'::jsonb)
)::jsonb AS places;

-- name: PlacesNear :one
-- The pin's surroundings: the district it falls in (null outside the city) and,
-- once a name is typed, places within 150 m with a similar name, as the
-- duplicate check. Public places, plus the viewer's own private ones.
WITH point AS (
    SELECT ST_SetSRID(ST_MakePoint(sqlc.arg(lng)::float8, sqlc.arg(lat)::float8), 4326) AS geom
), district AS (
    SELECT district.slug, district.name
    FROM areas AS district
    JOIN areas AS city ON city.id = district.parent_id
    CROSS JOIN point
    WHERE city.type = 'city' AND city.slug = sqlc.arg(city_slug) AND district.type = 'district'
        AND ST_Contains(district.boundary, point.geom)
    LIMIT 1
), query AS (
    SELECT lower(btrim(sqlc.arg(query)::text)) AS text
), nearby AS (
    SELECT places.id, places.slug, places.name, places.type, places.kind_text, places.location,
        places.created_by IS NOT NULL AS private, district.slug AS district_slug, district.name AS district_name,
        ST_Distance(places.location::geography, point.geom::geography) AS distance_m,
        similarity(lower(places.name), query.text) AS score
    FROM places
    JOIN areas AS district ON district.id = places.area_id
    JOIN areas AS city ON city.id = district.parent_id
    CROSS JOIN point
    CROSS JOIN query
    WHERE city.slug = sqlc.arg(city_slug) AND length(query.text) >= 2
        AND places.status = 'active'
        AND (places.created_by IS NULL AND places.review_status <> 'rejected'
            OR places.created_by = sqlc.narg(viewer_id)::uuid)
        AND ST_DWithin(places.location::geography, point.geom::geography, 150)
        AND (lower(places.name) % query.text
            OR places.search_text LIKE '%' || replace(replace(replace(query.text, '\', '\\'), '%', '\%'), '_', '\_') || '%')
)
SELECT jsonb_build_object(
    'district', (SELECT jsonb_build_object('slug', district.slug, 'name', district.name) FROM district),
    'places', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', nearby.id, 'slug', nearby.slug, 'name', nearby.name, 'type', nearby.type,
        'kind_text', nearby.kind_text, 'private', nearby.private,
        'district', jsonb_build_object('slug', nearby.district_slug, 'name', nearby.district_name),
        'coordinates', jsonb_build_array(round(ST_X(nearby.location)::numeric, 6), round(ST_Y(nearby.location)::numeric, 6)),
        'distance_m', round(nearby.distance_m)
    ) ORDER BY nearby.score DESC, nearby.distance_m, nearby.id)
    FROM (SELECT * FROM nearby ORDER BY score DESC, distance_m LIMIT 5) AS nearby), '[]'::jsonb)
)::jsonb AS results;

-- name: DistrictAt :one
-- The district of a city that contains a point; no row outside the city.
SELECT district.id, district.slug
FROM areas AS district
JOIN areas AS city ON city.id = district.parent_id
WHERE city.type = 'city' AND city.slug = sqlc.arg(city_slug) AND district.type = 'district'
    AND ST_Contains(district.boundary, ST_SetSRID(ST_MakePoint(sqlc.arg(lng)::float8, sqlc.arg(lat)::float8), 4326))
LIMIT 1;

-- name: PlaceSlugsLike :many
-- Slugs in a district that a new place's slug could clash with.
SELECT slug FROM places
WHERE area_id = sqlc.arg(area_id) AND (slug = sqlc.arg(base)::text OR slug LIKE sqlc.arg(base)::text || '-%');

-- name: CreatePinnedPlace :one
-- A place someone pinned, created together with its first event. created_by is
-- set only for private places.
INSERT INTO places (area_id, name, type, location, slug, source, review_status, created_by, kind_text)
VALUES (sqlc.arg(area_id), sqlc.arg(name), sqlc.arg(type)::place_type,
    ST_SetSRID(ST_MakePoint(sqlc.arg(lng)::float8, sqlc.arg(lat)::float8), 4326),
    sqlc.arg(slug), 'user', 'unreviewed', sqlc.narg(created_by)::uuid, sqlc.narg(kind_text)::text)
RETURNING id;

-- name: EventsCreatedToday :one
-- Events this person created through the app since midnight in Lahore. Seeded
-- and imported events are not counted.
SELECT count(*) FROM activities
WHERE action = 'event_created' AND user_id = sqlc.arg(user_id)
    AND occurred_at >= (date_trunc('day', statement_timestamp() AT TIME ZONE 'Asia/Karachi') AT TIME ZONE 'Asia/Karachi');
