-- Optional development data: fictional events at real OpenStreetMap places so the
-- explore pages have something to show. Apply after lahore_osm_places.sql and demo.sql
-- with psql --single-transaction -v ON_ERROR_STOP=1.
-- Fixed IDs make repeated runs harmless; each run moves start times back into the
-- coming week (Lahore evenings), so the sample stays upcoming.
WITH sample_events (number, osm_ref, spot_slug, title, type, days_ahead, local_time, capacity, guests) AS (
    VALUES
    (1,  'way/70017485', 'football-field', 'An evening five-a-side', 'football', 1, time '17:30', 10, 3),
    (2,  'way/70017485', 'cricket-ground', 'Tape-ball before dinner', 'cricket', 1, time '18:00', 12, 2),
    (3,  'way/70017485', 'tennis-court', 'Doubles after class', 'tennis', 2, time '18:30', 4, 1),
    (4,  'way/70017485', 'football-field', 'One more under the lights', 'football', 3, time '19:30', 10, 1),
    (5,  'way/70017485', 'basketball-court', 'Half-court under the lights', 'basketball', 4, time '20:00', 6, 2),
    (6,  'way/544739515', NULL, 'A friendly doubles match', 'badminton', 2, time '18:30', 4, 1),
    (7,  'way/1570619416', NULL, 'After-work badminton', 'badminton', 3, time '19:00', 4, 2),
    (8,  'node/5252199923', NULL, 'Morning laps together', 'swimming', 5, time '07:30', 6, 1),
    (9,  'node/14206757012', NULL, 'A friendly doubles match', 'padel', 1, time '20:00', 4, 2),
    (10, 'node/7374594736', NULL, 'Coffee & a conversation', 'coffee', 1, time '17:30', 5, 2),
    (11, 'node/7374594736', NULL, 'Bring a book, stay for chai', 'coffee', 4, time '18:30', 6, 1),
    (12, 'node/7255015825', NULL, 'Coffee & a conversation', 'coffee', 2, time '17:30', 5, 3),
    (13, 'node/7255015825', NULL, 'Bring a book, stay for chai', 'coffee', 5, time '18:30', 6, 1),
    (14, 'way/618639224', NULL, 'An evening of live music', 'music', 1, time '20:00', 8, 4),
    (15, 'way/618639224', NULL, 'Art & conversation', 'art', 3, time '18:30', 8, 2),
    (16, 'way/618639224', NULL, 'A small theatre circle', 'theatre', 6, time '19:00', 8, 3),
    (17, 'way/172700971', NULL, 'Watch the match together', 'cricket', 2, time '19:30', 10, 5),
    (18, 'way/905330999', NULL, 'Campus reading circle', 'reading', 3, time '17:30', 8, 2),
    (19, 'way/173961470', NULL, 'A sunset walk', 'walk', 1, time '17:30', 8, 3),
    (20, 'way/173961470', NULL, 'An easy neighbourhood run', 'run', 3, time '06:30', 10, 2),
    (21, 'way/173961470', NULL, 'Sketching under the trees', 'art', 5, time '17:00', 6, 1),
    (22, 'way/544513085', NULL, 'Meet for a movie', 'movie', 2, time '20:00', 6, 2),
    (23, 'node/5271810943', NULL, 'An evening over chai', 'meetup', 4, time '19:00', 10, 3),
    (24, 'way/317474464', NULL, 'A sunset walk', 'walk', 2, time '17:30', 8, 1),
    (25, 'way/620739083', NULL, 'Dinner after the film', 'movie', 3, time '20:30', 6, 2),
    (26, 'way/1573542588', NULL, 'Coffee & a conversation', 'coffee', 1, time '18:00', 5, 1),
    (27, 'way/1573542588', NULL, 'Bring a book, stay for chai', 'coffee', 4, time '17:30', 6, 2),
    (28, 'node/6221318686', NULL, 'Explore the exhibition together', 'exhibition', 2, time '16:00', 10, 4),
    (29, 'node/6221318686', NULL, 'Design & ideas meetup', 'meetup', 5, time '18:00', 12, 3),
    (30, 'way/618639224', NULL, 'An evening of live music', 'music', 2, time '20:00', 8, 3),
    (31, 'way/618639224', NULL, 'Art & conversation', 'art', 6, time '18:30', 8, 1),
    (32, 'way/290937635', NULL, 'A sunset walk', 'walk', 1, time '17:00', 8, 2),
    (33, 'way/611953494', NULL, 'Meet the neighbourhood', 'meetup', 3, time '19:30', 10, 2),
    (34, 'node/5096092621', NULL, 'Meet for a movie', 'movie', 4, time '20:00', 6, 1),
    (35, 'way/105841051', NULL, 'A photography walk', 'photography', 2, time '16:30', 8, 3),
    (36, 'way/232401428', NULL, 'Stories from old Lahore', 'walk', 5, time '17:00', 10, 2),
    (37, 'way/316465315', NULL, 'A conversation after class', 'meetup', 1, time '16:30', 8, 1),
    (38, 'way/246128683', NULL, 'A sunset walk', 'walk', 3, time '17:30', 8, 2),
    (39, 'way/246128683', NULL, 'An easy neighbourhood run', 'run', 6, time '06:30', 10, 1),
    (40, 'node/4916640090', NULL, 'Art & conversation', 'art', 4, time '18:30', 8, 2)
), resolved_events AS (
    SELECT
        ('40000000-0000-4000-8000-' || lpad(sample_events.number::text, 12, '0'))::uuid AS id,
        -- Rotate hosts across the six demo users.
        (sample_events.number - 1) % 6 + 1 AS host_number,
        ('20000000-0000-4000-8000-' || lpad(((sample_events.number - 1) % 6 + 1)::text, 12, '0'))::uuid AS host_id,
        places.id AS place_id,
        place_spots.id AS spot_id,
        sample_events.title,
        sample_events.type,
        (date_trunc('day', statement_timestamp() AT TIME ZONE 'Asia/Karachi')
            + sample_events.days_ahead * interval '1 day' + sample_events.local_time)
            AT TIME ZONE 'Asia/Karachi' AS starts_at,
        sample_events.capacity,
        sample_events.guests
    FROM sample_events
    JOIN places ON places.osm_ref = sample_events.osm_ref
    LEFT JOIN place_spots ON place_spots.place_id = places.id AND place_spots.slug = sample_events.spot_slug
), saved_events AS (
    INSERT INTO events (id, host_id, place_id, spot_id, status_id, title, type, starts_at, capacity)
    SELECT id, host_id, place_id, spot_id, '10000000-0000-4000-8000-000000000001', title, type, starts_at, capacity
    FROM resolved_events
    ON CONFLICT (id) DO UPDATE SET starts_at = EXCLUDED.starts_at
    RETURNING id
)
-- Seat 0 is the host, as CreateEvent guarantees; guests are the next demo users.
INSERT INTO event_participants (event_id, user_id)
SELECT
    saved_events.id,
    ('20000000-0000-4000-8000-' || lpad(((resolved_events.host_number - 1 + seat) % 6 + 1)::text, 12, '0'))::uuid
FROM saved_events
JOIN resolved_events ON resolved_events.id = saved_events.id
CROSS JOIN generate_series(0, resolved_events.guests) AS seat
ON CONFLICT (event_id, user_id) DO NOTHING;
