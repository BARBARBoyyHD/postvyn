-- Which user may act inside which workspace, and with what role.
-- This is the authorization hinge that replaced the row-level security D1 cannot provide
-- (ADR-014). `user_id` points at Better Auth's `user` table, which arrives in migration 0013+.
CREATE TABLE memberships (
  id            TEXT    PRIMARY KEY,
  user_id       TEXT    NOT NULL,
  workspace_id  TEXT    NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  role          TEXT    NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- A user holds exactly one role per workspace; no duplicate invitations.
CREATE UNIQUE INDEX one_membership_per_user_per_workspace ON memberships (user_id, workspace_id);

-- The hot path: "which workspaces can this user see" and "who is in this workspace".
CREATE INDEX memberships_by_workspace ON memberships (workspace_id);
