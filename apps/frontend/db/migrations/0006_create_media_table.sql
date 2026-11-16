-- Uploaded assets. The bytes live in R2 under `key`; this table holds what the app needs to reason
-- about them — size (platform limits), dimensions (aspect ratios), and whether the file is postable
-- at all (contact sheets, previews and working files must never ship).
CREATE TABLE media (
  id            TEXT    PRIMARY KEY,
  workspace_id  TEXT    NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  hash          TEXT    NOT NULL,            -- content hash: the same file uploaded twice costs once
  key           TEXT    NOT NULL,            -- R2 object key
  mime          TEXT    NOT NULL,
  bytes         INTEGER NOT NULL,
  width         INTEGER,
  height        INTEGER,
  postable      INTEGER NOT NULL DEFAULT 1,  -- 0 = reference material, never publishable
  created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE UNIQUE INDEX one_media_per_hash_per_workspace ON media (workspace_id, hash);

CREATE INDEX media_postable_by_workspace ON media (workspace_id, postable);
