-- The unit of work the operator sees on the board. Status is forward-only
-- (idea → researched → drafting → review → approved → scheduled → published); a backwards move needs
-- a reason and an activity_log entry, so the enum is deliberately wide.
CREATE TABLE posts (
  id            TEXT    PRIMARY KEY,
  workspace_id  TEXT    NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  brand_id      TEXT    NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  title         TEXT    NOT NULL,
  format        TEXT    NOT NULL,            -- single | carousel | reel | story — validated in code
  status        TEXT    NOT NULL DEFAULT 'idea'
                        CHECK (status IN ('idea', 'researched', 'drafting', 'review', 'approved',
                                          'scheduled', 'published', 'failed', 'archived')),
  pillar        TEXT,                        -- content pillar, free text
  schedule_at   INTEGER,                     -- unix-ms; null until the post is slotted
  created_by    TEXT,                        -- user id; null for importer-created rows
  created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- The board: "this brand's posts in this status".
CREATE INDEX posts_by_brand_status ON posts (brand_id, status);

-- The scheduler: "what is due", and the importer's idempotent re-run.
CREATE INDEX posts_due_by_status_time ON posts (status, schedule_at);
