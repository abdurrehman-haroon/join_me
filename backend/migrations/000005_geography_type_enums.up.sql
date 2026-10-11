CREATE TYPE area_type AS ENUM ('city', 'district', 'campus');
CREATE TYPE place_type AS ENUM ('ground', 'court', 'cafe', 'park');

ALTER TABLE areas DROP CONSTRAINT areas_type_check;
ALTER TABLE areas ALTER COLUMN type TYPE area_type USING type::area_type;

ALTER TABLE places DROP CONSTRAINT places_type_check;
ALTER TABLE places ALTER COLUMN type TYPE place_type USING type::place_type;
