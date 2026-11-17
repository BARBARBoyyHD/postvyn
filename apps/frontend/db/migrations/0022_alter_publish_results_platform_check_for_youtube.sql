-- `youtube` joins the `publish_results` platform CHECK and `x` stays (design decisions 7-8): past
-- results keep rendering, and a rebuild that deleted them would rewrite publishing history.
--
-- Nothing references `publish_results`, so this rebuild is the plain copy-and-swap that `channels`
-- could not be (see 0021: D1's `drop table` fires `ON DELETE CASCADE`, and `channels` has children).
--
-- `estimated_cost_usd` is carried verbatim from 0019: no supported platform charges money today, but
-- the column is generic and a stored estimate is somebody's record of what a post cost.
create table publish_results_next (
  id                TEXT    PRIMARY KEY,
  variant_id        TEXT    NOT NULL REFERENCES variants (id) ON DELETE CASCADE,
  platform          TEXT    NOT NULL CHECK (platform IN ('instagram', 'threads', 'youtube', 'tiktok', 'x')),
  platform_post_id  TEXT,
  url               TEXT,
  raw               TEXT,
  state             TEXT    NOT NULL CHECK (state IN ('succeeded', 'failed', 'uncertain')),
  created_at        INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  estimated_cost_usd REAL
);

insert into publish_results_next select * from publish_results;
drop table publish_results;
alter table publish_results_next rename to publish_results;

create unique index one_publish_per_variant on publish_results (variant_id) where state = 'succeeded';
create index publish_results_by_variant on publish_results (variant_id, created_at DESC);
