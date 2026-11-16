-- Better Auth's tables (v1.7.x), mirrored from `@better-auth/cli generate` output in
-- `src/db/auth-schema.ts`. These are the only tables this project does not author: regenerate rather
-- than hand-edit when Better Auth changes.
--
-- Conventions match the rest of the schema: TEXT ids, INTEGER millisecond timestamps. Better Auth's
-- own hash for the password lives in `account.password`; we never touch it.
--
-- One deliberate addition: `updated_at` carries a DEFAULT here even though the generated schema only
-- sets it on update. Without it, any insert that omits the column fails on a NOT NULL constraint —
-- a footgun with no upside, and the value is overwritten on the next update anyway.

CREATE TABLE "user" (
  id             TEXT    PRIMARY KEY NOT NULL,
  name           TEXT    NOT NULL,
  email          TEXT    NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  image          TEXT,
  created_at     INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsecond') * 1000 AS INTEGER)),
  updated_at     INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsecond') * 1000 AS INTEGER))
);

CREATE TABLE session (
  id          TEXT    PRIMARY KEY NOT NULL,
  expires_at  INTEGER NOT NULL,
  token       TEXT    NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsecond') * 1000 AS INTEGER)),
  updated_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsecond') * 1000 AS INTEGER)),
  ip_address  TEXT,
  user_agent  TEXT,
  user_id     TEXT    NOT NULL REFERENCES "user" (id) ON DELETE CASCADE
);

CREATE INDEX session_userId_idx ON session (user_id);

-- `expires_at` is indexed because revoke-all and expiry sweeps both read by it.
CREATE INDEX session_expires_at_idx ON session (expires_at);

CREATE TABLE account (
  id                        TEXT    PRIMARY KEY NOT NULL,
  account_id                TEXT    NOT NULL,
  provider_id               TEXT    NOT NULL,
  user_id                   TEXT    NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  access_token              TEXT,
  refresh_token             TEXT,
  id_token                  TEXT,
  access_token_expires_at   INTEGER,
  refresh_token_expires_at  INTEGER,
  scope                     TEXT,
  password                  TEXT,
  created_at                INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsecond') * 1000 AS INTEGER)),
  updated_at                INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsecond') * 1000 AS INTEGER))
);

CREATE INDEX account_userId_idx ON account (user_id);

CREATE TABLE verification (
  id          TEXT    PRIMARY KEY NOT NULL,
  identifier  TEXT    NOT NULL,
  value       TEXT    NOT NULL,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsecond') * 1000 AS INTEGER)),
  updated_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsecond') * 1000 AS INTEGER))
);

CREATE INDEX verification_identifier_idx ON verification (identifier);
