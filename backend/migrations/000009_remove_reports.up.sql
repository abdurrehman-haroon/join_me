-- Reporting is deferred; remove the legacy reference before dropping its table.
ALTER TABLE moderation_log DROP COLUMN report_id;
DROP TABLE reports;
