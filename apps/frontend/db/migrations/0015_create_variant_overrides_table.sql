-- An accepted warning is an event, not a property: who accepted it, when, and why.
-- Keeping it in a table (rather than a JSON column on `variants`) is what makes "why is this post
-- shipping with a warning" answerable a year later, and what lets the publish path check that every
-- warning currently on the variant has an override behind it.
create table if not exists variant_overrides (
  id          TEXT    PRIMARY KEY,
  variant_id  TEXT    NOT NULL REFERENCES variants (id) ON DELETE CASCADE,
  workspace_id TEXT   NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  issue_field TEXT    NOT NULL,              -- caption | hashtags | media
  issue_key   TEXT    NOT NULL,              -- the warning's identity, so a new warning is not covered
  reason      TEXT    NOT NULL,              -- why the operator accepted it
  actor_id    TEXT,                          -- null only for the importer
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

create index if not exists idx_variant_overrides_variant on variant_overrides (variant_id);

-- Append-only, like activity_log: an override that can be edited is not a record.
create trigger if not exists variant_overrides_no_update
before update on variant_overrides
begin
  select raise(abort, 'variant_overrides is append-only');
end;

create trigger if not exists variant_overrides_no_delete
before delete on variant_overrides
begin
  select raise(abort, 'variant_overrides is append-only');
end;
