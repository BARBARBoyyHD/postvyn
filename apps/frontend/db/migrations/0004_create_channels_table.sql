-- One publishing destination: a brand's account on a platform. A brand may hold several accounts on
-- the same platform (two IG profiles, a client's page), which is why the token is not a column here.
CREATE TABLE channels (
  id           TEXT    PRIMARY KEY,
  brand_id     TEXT    NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  platform     TEXT    NOT NULL CHECK (platform IN ('instagram', 'threads', 'x', 'tiktok')),
  account_ref  TEXT    NOT NULL,             -- the platform's own id, never the mutable handle
  label        TEXT,                         -- what the operator calls it in the UI
  status       TEXT    NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'reauth_required', 'disabled')),
  created_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Load-bearing: many accounts overall, but exactly one row per (brand, platform, account).
-- Adding this to an empty table is free; adding it later, with duplicates already inside, is not.
CREATE UNIQUE INDEX one_account_per_platform ON channels (brand_id, platform, account_ref);

CREATE INDEX channels_by_brand ON channels (brand_id);
