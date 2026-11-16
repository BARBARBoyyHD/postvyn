-- The operator's own workspace. Fixed id so the seed is idempotent and so other seeds and tests can
-- refer to it without a lookup.
--
-- Publishing starts OFF: the kill switch (ADR-019) is turned on deliberately, not by seeding.
INSERT OR IGNORE INTO workspaces (id, name, plan, timezone, publishing_enabled)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Uwi',
  'free',
  'Asia/Jakarta',
  0
);
