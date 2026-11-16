-- A brand is the "profile" the operator switches between. Voice and colours live here so no design
-- or caption ever hardcodes an accent — the renderer takes them as input.
CREATE TABLE brands (
  id            TEXT    PRIMARY KEY,
  workspace_id  TEXT    NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  slug          TEXT    NOT NULL,            -- url-safe, stable: 'zavron', 'personal'
  name          TEXT    NOT NULL,
  handle        TEXT,                        -- primary public handle, for display only
  voice         TEXT,                        -- JSON: tone rules the caption writer obeys
  colors        TEXT,                        -- JSON: accent + plate tokens
  created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Slugs are unique within a workspace, not globally: two workspaces may both have a "personal".
CREATE UNIQUE INDEX one_brand_slug_per_workspace ON brands (workspace_id, slug);
