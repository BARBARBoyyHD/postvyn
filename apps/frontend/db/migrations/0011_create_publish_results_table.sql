-- Proof, not intent. One row per publish attempt that reached the platform, with the platform's own
-- post id and URL. `raw` keeps the response body: when a platform says "posted" but the post is not
-- there, the response is the only evidence.
--
-- `uncertain` is a real state, not a hedge: the request may succeed while the response is lost
-- (timeout, Worker killed mid-flight). Guessing "failed" there risks a double post, so it is recorded
-- as uncertain and surfaced to the operator instead.
CREATE TABLE publish_results (
  id                TEXT    PRIMARY KEY,
  variant_id        TEXT    NOT NULL REFERENCES variants (id) ON DELETE CASCADE,
  platform          TEXT    NOT NULL CHECK (platform IN ('instagram', 'threads', 'x', 'tiktok')),
  platform_post_id  TEXT,
  url               TEXT,
  raw               TEXT,                    -- JSON response, truncated if huge
  state             TEXT    NOT NULL CHECK (state IN ('succeeded', 'failed', 'uncertain')),
  created_at        INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- One successful publish per variant, ever. A partial unique index, so failed and uncertain attempts
-- can pile up without blocking the retry that eventually succeeds.
CREATE UNIQUE INDEX one_publish_per_variant ON publish_results (variant_id) WHERE state = 'succeeded';

CREATE INDEX publish_results_by_variant ON publish_results (variant_id, created_at DESC);
