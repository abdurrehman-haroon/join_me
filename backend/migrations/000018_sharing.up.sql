-- Sharing a plan: from the moment after posting (the celebration screen and the
-- Share bar it leaves on the map) and from event details.
ALTER TYPE activity_action ADD VALUE 'event_shared';
ALTER TYPE activity_action ADD VALUE 'celebration_closed';
ALTER TYPE activity_source ADD VALUE 'celebration';
