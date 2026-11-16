-- Durable work queue. A Worker cannot outlive the request that started it (ADR-018), so publishing is
-- a row here, claimed by a cron invocation, not a promise or a background thread.
--
-- States: queued → claimed → awaiting_platform | done | failed
-- `awaiting_platform` exists because a publish has two legs (create container, then publish it) and
-- the second leg may land in a later invocation.
CREATE TABLE jobs (
  id            TEXT    PRIMARY KEY,
  kind          TEXT    NOT NULL,            -- publish_variant | refresh_token | import_batch
  payload       TEXT    NOT NULL,            -- JSON
  state         TEXT    NOT NULL DEFAULT 'queued'
                        CHECK (state IN ('queued', 'claimed', 'awaiting_platform', 'done', 'failed', 'dead')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  run_after     INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  lease_until   INTEGER,                     -- claimed-at + timeout; past this, the row is reclaimable
  last_error    TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- The claim query: "oldest runnable job". D1's single writer serialises claims, so this index plus
-- one UPDATE ... RETURNING is the whole locking story (ADR-015).
CREATE INDEX jobs_claimable ON jobs (state, run_after);

-- Housekeeping: find abandoned leases.
CREATE INDEX jobs_by_lease ON jobs (state, lease_until);
