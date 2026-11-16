-- One token per agent integration, scoped to a workspace and a brand.
--
-- Only the hash is stored. A token is compared, never replayed, so a dump of this table yields nothing
-- usable — the opposite of `channel_credentials`, where the plaintext must be recoverable to call a
-- platform (ADR-011).
create table if not exists agent_tokens (
  id          TEXT    PRIMARY KEY,
  workspace_id TEXT   NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  brand_id    TEXT    NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  label       TEXT    NOT NULL,              -- "hermes-reels" — what this token is for
  token_hash  TEXT    NOT NULL UNIQUE,       -- sha256 hex of the secret
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  last_used_at INTEGER,
  revoked_at  INTEGER                        -- set once, never cleared: revocation is a tombstone
);

create index if not exists idx_agent_tokens_workspace on agent_tokens (workspace_id, revoked_at);
