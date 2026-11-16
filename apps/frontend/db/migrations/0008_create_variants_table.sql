-- One post, one channel, one caption. This is the row that actually gets published, and the row that
-- gets approved — a post with three channels has three variants, each with its own caption limits,
-- hashtag rules and spec verdict.
CREATE TABLE variants (
  id            TEXT    PRIMARY KEY,
  post_id       TEXT    NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  channel_id    TEXT    NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
  caption       TEXT    NOT NULL DEFAULT '',
  hashtags      TEXT,                        -- JSON array of strings
  media_ids     TEXT,                        -- JSON array, order preserved: carousel sequence
  spec_state    TEXT    NOT NULL DEFAULT 'unchecked'
                        CHECK (spec_state IN ('unchecked', 'ok', 'warn', 'blocked')),
  spec_version  TEXT,                        -- which social/<platform>/specs.md this was checked against
  created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- A post targets a given channel once. Two variants for the same channel is a bug, not a feature.
CREATE UNIQUE INDEX one_variant_per_post_per_channel ON variants (post_id, channel_id);

CREATE INDEX variants_by_channel ON variants (channel_id);
