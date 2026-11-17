-- `youtube` joins the `channels` platform CHECK and `x` stays in it (platform-swap-youtube design
-- decisions 7-8): SQLite cannot ALTER a CHECK, so the table is rebuilt, and the copy would fail on the
-- legacy X rows this migration deliberately keeps. New X rows are prevented in code -- the `Platform`
-- union, the registry's exhaustive switch and the connect schema -- never by dropping history.
--
-- The rebuild is not the textbook copy-and-drop. D1 forces `foreign_keys=ON` for every statement and
-- `PRAGMA defer_foreign_keys` does not suspend `ON DELETE CASCADE`
-- (developers.cloudflare.com/d1/sql-api/sql-statements, read 2026-11-17: "does not prevent ON DELETE
-- CASCADE actions from being executed"; `PRAGMA foreign_keys=off` inside a migration proves to have no
-- effect on this runtime). `drop table channels` therefore runs the implicit DELETE, which cascades to
-- every variant, then to its approvals, publish results and overrides, and to its encrypted token. The
-- five tables are set aside first and put back below; a rebuild that loses a published post is worse
-- than the CHECK it wanted.
create table channels_next (
  id           TEXT    PRIMARY KEY,
  brand_id     TEXT    NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  platform     TEXT    NOT NULL CHECK (platform IN ('instagram', 'threads', 'youtube', 'tiktok', 'x')),
  account_ref  TEXT    NOT NULL,
  label        TEXT,
  status       TEXT    NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'reauth_required', 'disabled')),
  created_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

create table variants_kept as select * from variants;
create table approvals_kept as select * from approvals;
create table publish_results_kept as select * from publish_results;
create table variant_overrides_kept as select * from variant_overrides;
create table channel_credentials_kept as select * from channel_credentials;

-- The cascade reaches `variant_overrides`, whose append-only trigger aborts the DELETE (0015). Dropped
-- for the length of the swap and recreated exactly as 0015 wrote it, below.
drop trigger variant_overrides_no_delete;

insert into channels_next select * from channels;
drop table channels;
alter table channels_next rename to channels;

create unique index one_account_per_platform on channels (brand_id, platform, account_ref);
create index channels_by_brand on channels (brand_id);

-- Parents before children, so every reference is satisfied when the row lands.
insert into variants select * from variants_kept;
insert into approvals select * from approvals_kept;
insert into publish_results select * from publish_results_kept;
insert into variant_overrides select * from variant_overrides_kept;
insert into channel_credentials select * from channel_credentials_kept;

drop table variants_kept;
drop table approvals_kept;
drop table publish_results_kept;
drop table variant_overrides_kept;
drop table channel_credentials_kept;

-- X left the lineup on 2026-11-17 (design decision 7): the channel row and everything published to it
-- stay; the switch goes off and the token is deleted, so nothing can publish through it again.
--
-- Above the trigger, never below it: `wrangler d1 migrations apply` splits a file on semicolons, and a
-- `create trigger ... begin ... end;` block has to be the file's last statement - a probe migration
-- with DML after one fails with "incomplete input".
update channels set status = 'disabled', updated_at = unixepoch() * 1000 where platform = 'x';
delete from channel_credentials where channel_id in (select id from channels where platform = 'x');

create trigger variant_overrides_no_delete
before delete on variant_overrides
begin
  select raise(abort, 'variant_overrides is append-only');
end;
