-- Imported posts need an identity that survives a folder rename. The vault's item id is stable; the
-- path is not, and deriving identity from a path means a rename imports the same post twice.
--
-- Nullable on purpose: posts created in the app have no external reference, and SQLite treats NULLs
-- as distinct in a unique index, so they never collide with each other.
ALTER TABLE posts ADD COLUMN external_ref TEXT;

CREATE UNIQUE INDEX one_post_per_brand_external_ref ON posts (brand_id, external_ref);
