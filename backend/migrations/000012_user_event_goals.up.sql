CREATE TYPE event_goal_period AS ENUM ('weekly', 'monthly');

ALTER TABLE users
    ADD COLUMN event_goal_target integer CHECK (event_goal_target > 0),
    ADD COLUMN event_goal_period event_goal_period,
    ADD CONSTRAINT users_event_goal_pair CHECK (
        (event_goal_target IS NULL) = (event_goal_period IS NULL)
    );
