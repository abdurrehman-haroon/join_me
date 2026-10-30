-- name: GetArea :one
WITH area_view AS (
    SELECT areas.*, COALESCE(boundary, (
        SELECT ST_Expand(ST_Extent(location)::geometry, 0.001)
        FROM places WHERE area_id = areas.id
    )) AS view_boundary
    FROM areas WHERE areas.id = sqlc.arg(id)
)
SELECT jsonb_build_object(
    'id', area_view.id, 'parent_id', area_view.parent_id, 'name', area_view.name, 'type', area_view.type,
    'boundary', ST_AsGeoJSON(area_view.boundary)::jsonb,
    'bbox', CASE WHEN area_view.view_boundary IS NOT NULL THEN jsonb_build_array(
        ST_XMin(Box3D(area_view.view_boundary)), ST_YMin(Box3D(area_view.view_boundary)),
        ST_XMax(Box3D(area_view.view_boundary)), ST_YMax(Box3D(area_view.view_boundary))) ELSE NULL END,
    'created_at', area_view.created_at, 'updated_at', area_view.updated_at
)::jsonb AS area
FROM area_view;

-- name: ListChildAreas :one
-- The areas inside an area (DHA's phases), with outlines for drawing them. Returns no row
-- when the parent area does not exist.
SELECT jsonb_build_object(
    'type', 'FeatureCollection',
    'features', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'type', 'Feature', 'id', child.id,
            'geometry', ST_AsGeoJSON(child.boundary)::jsonb,
            'properties', jsonb_build_object(
                'id', child.id, 'parent_id', child.parent_id, 'name', child.name, 'type', child.type,
                'bbox', CASE WHEN child.view_boundary IS NOT NULL THEN jsonb_build_array(
                    ST_XMin(Box3D(child.view_boundary)), ST_YMin(Box3D(child.view_boundary)),
                    ST_XMax(Box3D(child.view_boundary)), ST_YMax(Box3D(child.view_boundary))) ELSE NULL END,
                'created_at', child.created_at, 'updated_at', child.updated_at)
        ) ORDER BY child.name)
        FROM (
            -- Areas without a mapped outline, like Rahbar, are framed by their places.
            SELECT areas.*, COALESCE(boundary, (
                SELECT ST_Expand(ST_Extent(location)::geometry, 0.001)
                FROM places WHERE area_id = areas.id
            )) AS view_boundary
            FROM areas WHERE areas.parent_id = parent.id
        ) AS child
    ), '[]'::jsonb)
)::jsonb AS areas
FROM areas AS parent
WHERE parent.id = sqlc.arg(id);

-- name: ListPlacesInBounds :one
WITH visible_places AS (
    SELECT * FROM places
    WHERE location && ST_MakeEnvelope(
        sqlc.arg(west)::float8, sqlc.arg(south)::float8,
        sqlc.arg(east)::float8, sqlc.arg(north)::float8, 4326)
    ORDER BY id
    LIMIT 1001
), numbered_places AS (
    SELECT *, row_number() OVER (ORDER BY id) AS position FROM visible_places
)
SELECT jsonb_build_object(
    'type', 'FeatureCollection',
    'truncated', count(*) > 1000,
    'features', COALESCE(jsonb_agg(jsonb_build_object(
        'type', 'Feature', 'id', id, 'geometry', ST_AsGeoJSON(location)::jsonb,
        'properties', jsonb_build_object('id', id, 'area_id', area_id, 'name', name, 'type', type,
            'boundary', ST_AsGeoJSON(boundary)::jsonb, 'created_at', created_at, 'updated_at', updated_at)
    ) ORDER BY id) FILTER (WHERE position <= 1000), '[]'::jsonb)
)::jsonb AS places
FROM numbered_places;
