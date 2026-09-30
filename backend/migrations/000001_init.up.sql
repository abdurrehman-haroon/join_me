CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE users (
    id uuid PRIMARY KEY,
    campus_id text NOT NULL,
    email text NOT NULL UNIQUE,
    verified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pins (
    id uuid PRIMARY KEY,
    host_id uuid NOT NULL REFERENCES users(id),
    campus_id text NOT NULL,
    sport text NOT NULL CHECK (sport IN ('football', 'cricket')),
    ground_name text NOT NULL,
    location geography(Point, 4326) NOT NULL,
    kickoff_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    capacity integer NOT NULL CHECK (capacity > 0),
    visibility text NOT NULL CHECK (visibility IN ('campus', 'women', 'contacts')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pins_location_idx ON pins USING GIST (location);
CREATE INDEX pins_expires_at_idx ON pins (expires_at);

CREATE TABLE pin_members (
    pin_id uuid NOT NULL REFERENCES pins(id),
    user_id uuid NOT NULL REFERENCES users(id),
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (pin_id, user_id)
);

CREATE TABLE messages (
    id uuid PRIMARY KEY,
    pin_id uuid NOT NULL REFERENCES pins(id),
    user_id uuid NOT NULL REFERENCES users(id),
    body text NOT NULL,
    sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reports (
    id uuid PRIMARY KEY,
    reporter_id uuid NOT NULL REFERENCES users(id),
    subject_type text NOT NULL,
    subject_id uuid NOT NULL,
    reason text NOT NULL,
    status text NOT NULL DEFAULT 'open',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE moderation_log (
    id uuid PRIMARY KEY,
    report_id uuid REFERENCES reports(id),
    event_type text NOT NULL,
    details jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);

