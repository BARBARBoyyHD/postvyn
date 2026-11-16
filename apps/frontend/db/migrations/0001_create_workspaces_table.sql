-- The tenant boundary. Every other table hangs off a workspace id, and every query is scoped by it.
-- D1 has no row-level security, so this column is the boundary (ADR-014).
CREATE TABLE workspaces (
  id                  TEXT    PRIMARY KEY,
  name                TEXT    NOT NULL,
  plan                TEXT    NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'paid')),
  timezone            TEXT    NOT NULL DEFAULT 'UTC',        -- display only; storage is unix-ms UTC
  publishing_enabled  INTEGER NOT NULL DEFAULT 0,            -- ADR-019 kill switch, per workspace
  created_at          INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- One operator, one workspace of each name. Prevents a double-seed from creating twins.
CREATE UNIQUE INDEX one_workspace_per_name ON workspaces (name);
