-- Platform tokens, encrypted at rest with AES-256-GCM (ADR-011/012).
-- Split into its own table for one reason: `select * from channels` can never accidentally carry a
-- secret into a page, a log line or an API response.
--
-- The GCM tag is appended to the ciphertext (WebCrypto convention), so there is no tag column.
-- The channel id is bound in as additional authenticated data, so a database dump cannot move a
-- token from one channel to another and have it still decrypt.
CREATE TABLE channel_credentials (
  channel_id   TEXT    PRIMARY KEY REFERENCES channels (id) ON DELETE CASCADE,
  ciphertext   BLOB    NOT NULL,
  iv           BLOB    NOT NULL,             -- 12 bytes, unique per write, never reused
  key_version  INTEGER NOT NULL DEFAULT 1,   -- which TOKEN_ENCRYPTION_KEY encrypted this row
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- A rotation pass walks the table by key version, oldest first.
CREATE INDEX credentials_by_key_version ON channel_credentials (key_version);
