-- Approval is bound to CONTENT, not to a row id. `variant_hash` is the hash of the variant's caption,
-- hashtags and media order at the moment the operator approved it. Publishing recomputes the hash:
-- edit the caption after approval and the hash no longer matches, so the post returns to review and
-- must be approved again. This is what stops "approved" from meaning "approved something else".
CREATE TABLE approvals (
  id            TEXT    PRIMARY KEY,
  variant_id    TEXT    NOT NULL REFERENCES variants (id) ON DELETE CASCADE,
  variant_hash  TEXT    NOT NULL,
  user_id       TEXT    NOT NULL,
  approved_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  revoked_at    INTEGER,                     -- soft revoke: the history stays, the approval stops counting
  note          TEXT
);

-- "What is the current approval for this variant" — the newest non-revoked row.
CREATE INDEX approvals_by_variant_latest ON approvals (variant_id, approved_at DESC);
