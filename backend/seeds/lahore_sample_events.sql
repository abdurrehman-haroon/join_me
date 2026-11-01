-- Optional development data: fictional events across the Lahore catalog so the
-- explore pages have something to show. Apply after lahore_catalog.sql and demo.sql
-- with psql --single-transaction -v ON_ERROR_STOP=1.
-- Fixed IDs make repeated runs harmless; each run moves start times back into the
-- coming week (Lahore evenings), so the sample stays upcoming.
WITH sample_events (number, place_slug, spot_slug, title, type, days_ahead, local_time, capacity, guests) AS (
    VALUES
    (1,  'lums', 'football-field', 'An evening five-a-side', 'football', 1, time '17:30', 10, 3),
    (2,  'lums', 'cricket-ground', 'Tape-ball before dinner', 'cricket', 1, time '18:00', 12, 2),
    (3,  'lums', 'tennis-court', 'Doubles after class', 'tennis', 2, time '18:30', 4, 1),
    (4,  'lums', 'football-field', 'One more under the lights', 'football', 3, time '19:30', 10, 1),
    (5,  'lums', 'basketball-court', 'Half-court under the lights', 'basketball', 4, time '20:00', 6, 2),
    (6,  'defence-club-j-sector', NULL, 'A friendly doubles match', 'badminton', 2, time '18:30', 4, 1),
    (7,  'defence-club-r-sector', NULL, 'After-work badminton', 'badminton', 3, time '19:00', 4, 2),
    (8,  'dha-y-block-swimming-pool', NULL, 'Morning laps together', 'swimming', 5, time '07:30', 6, 1),
    (9,  'defence-club-ff-sector', NULL, 'A friendly doubles match', 'padel', 1, time '20:00', 4, 2),
    (10, 'cbtl-dha-phase-5', NULL, 'Coffee & a conversation', 'coffee', 1, time '17:30', 5, 2),
    (11, 'cbtl-dha-phase-5', NULL, 'Bring a book, stay for chai', 'coffee', 4, time '18:30', 6, 1),
    (12, 'cbtl-gulberg', NULL, 'Coffee & a conversation', 'coffee', 2, time '17:30', 5, 3),
    (13, 'cbtl-gulberg', NULL, 'Bring a book, stay for chai', 'coffee', 5, time '18:30', 6, 1),
    (14, 'alhamra-cultural-complex', NULL, 'An evening of live music', 'music', 1, time '20:00', 8, 4),
    (15, 'alhamra-cultural-complex', NULL, 'Art & conversation', 'art', 3, time '18:30', 8, 2),
    (16, 'alhamra-cultural-complex', NULL, 'A small theatre circle', 'theatre', 6, time '19:00', 8, 3),
    (17, 'gaddafi-stadium', NULL, 'Watch the match together', 'cricket', 2, time '19:30', 10, 5),
    (18, 'forman-christian-college', NULL, 'Campus reading circle', 'reading', 3, time '17:30', 8, 2),
    (19, 'model-town-park', NULL, 'A sunset walk', 'walk', 1, time '17:30', 8, 3),
    (20, 'model-town-park', NULL, 'An easy neighbourhood run', 'run', 3, time '06:30', 10, 2),
    (21, 'model-town-park', NULL, 'Sketching under the trees', 'art', 5, time '17:00', 6, 1),
    (22, 'amanah-mall', NULL, 'Meet for a movie', 'movie', 2, time '20:00', 6, 2),
    (23, 'qasar-e-noor-model-town', NULL, 'An evening over chai', 'meetup', 4, time '19:00', 10, 3),
    (24, 'doongi-ground', NULL, 'A sunset walk', 'walk', 2, time '17:30', 8, 1),
    (25, 'emporium-mall', NULL, 'Dinner after the film', 'movie', 3, time '20:30', 6, 2),
    (26, 'cbtl-johar-town', NULL, 'Coffee & a conversation', 'coffee', 1, time '18:00', 5, 1),
    (27, 'cbtl-johar-town', NULL, 'Bring a book, stay for chai', 'coffee', 4, time '17:30', 6, 2),
    (28, 'expo-centre-lahore', NULL, 'Explore the exhibition together', 'exhibition', 2, time '16:00', 10, 4),
    (29, 'expo-centre-lahore', NULL, 'Design & ideas meetup', 'meetup', 5, time '18:00', 12, 3),
    (30, 'alhamra-arts-council', NULL, 'An evening of live music', 'music', 2, time '20:00', 8, 3),
    (31, 'alhamra-arts-council', NULL, 'Art & conversation', 'art', 6, time '18:30', 8, 1),
    (32, 'bagh-e-jinnah', NULL, 'A sunset walk', 'walk', 1, time '17:00', 8, 2),
    (33, 'falettis-hotel', NULL, 'Meet the neighbourhood', 'meetup', 3, time '19:30', 10, 2),
    (34, 'packages-mall', NULL, 'Meet for a movie', 'movie', 4, time '20:00', 6, 1),
    (35, 'lahore-fort', NULL, 'A photography walk', 'photography', 2, time '16:30', 8, 3),
    (36, 'greater-iqbal-park', NULL, 'Stories from old Lahore', 'walk', 5, time '17:00', 10, 2),
    (37, 'punjab-university-new-campus', NULL, 'A conversation after class', 'meetup', 1, time '16:30', 8, 1),
    (38, 'jilani-park', NULL, 'A sunset walk', 'walk', 3, time '17:30', 8, 2),
    (39, 'jilani-park', NULL, 'An easy neighbourhood run', 'run', 6, time '06:30', 10, 1),
    (40, 'alliance-francaise-lahore', NULL, 'Art & conversation', 'art', 4, time '18:30', 8, 2)
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
    -- Place slugs are unique across the Lahore catalog.
    JOIN places ON places.slug = sample_events.place_slug
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
