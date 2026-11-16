-- Append-only history. What happened, who did it, to which post — the audit trail behind the status
-- machine. Enforced by triggers rather than convention: an UPDATE or DELETE aborts.
CREATE TABLE activity_log (
  id            TEXT    PRIMARY KEY,
  workspace_id  TEXT    NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  post_id       TEXT,                        -- not a FK: the log outlives the post it describes
  actor_id      TEXT,                        -- user id, or null for the importer and the cron
  action        TEXT    NOT NULL,            -- status_changed | approved | published | failed | …
  detail        TEXT,                        -- JSON: from/to, reason, platform response id
  created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX activity_by_workspace_time ON activity_log (workspace_id, created_at DESC);
CREATE INDEX activity_by_post ON activity_log (post_id, created_at DESC);

-- Append-only, enforced by the database. A log you can rewrite is not a log.
CREATE TRIGGER activity_log_no_update
BEFORE UPDATE ON activity_log
BEGIN
  SELECT RAISE(ABORT, 'activity_log is append-only');
END;

CREATE TRIGGER activity_log_no_delete
BEFORE DELETE ON activity_log
BEGIN
  SELECT RAISE(ABORT, 'activity_log is append-only');
END;
