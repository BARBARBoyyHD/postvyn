-- M6: media imported from v0.1 has `key` = a path into the content repo, which R2 cannot serve. The
-- path stays (an import dispute is worse than an ugly field); uploading the same bytes again writes
-- the object and records its key here. Readers prefer `r2_key` and fall back to `key` when that is
-- already an R2 key, so every row uploaded by this app needs no backfill.
ALTER TABLE media ADD COLUMN r2_key TEXT;
