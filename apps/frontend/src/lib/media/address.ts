/**
 * Where a media row's bytes live, and the address a platform fetches them from.
 *
 * Two rules, both learned the hard way in M5/M6:
 *
 *  1. **A URL is derived, never stored.** Projects are renamed, buckets move, and a custom domain
 *     changes once without anyone thinking of the database. Key + `R2_PUBLIC_BASE` makes that a config
 *     edit; a stored absolute URL makes it a migration with a broken week afterwards.
 *  2. **A vault path is not an R2 key.** Media imported from v0.1 carries a path into the content
 *     repo, which R2 cannot serve. Such a row keeps its path (an import dispute is worse than an ugly
 *     field) and gains `r2_key` when its bytes are uploaded (m6 2.4); readers ask for the key and are
 *     told the truth when there is none.
 */

/** Every key this app serves starts here — intake has written `media/<workspace>/<hash>.<ext>` since M2. */
export const R2_KEY_PREFIX = "media/";

/**
 * The R2 key for a row, or null when the row still only points at a vault path.
 *
 * `r2Key` wins because it is the explicit answer; a `key` that is already an R2 key is the shape every
 * row written by an upload has. Anything else is a path from the import.
 */
export function objectKey(row: { key: string; r2Key: string | null }): string | null {
  if (row.r2Key) return row.r2Key;
  return row.key.startsWith(R2_KEY_PREFIX) ? row.key : null;
}

/**
 * The public URL for a key, or null when nothing is public.
 *
 * Null — not a relative URL and not an empty string — because every caller has to decide what an
 * unconfigured base means, and "publish refuses" is the only acceptable answer (`m6` 2.2).
 */
export function publicMediaUrl(base: string | undefined, key: string | null): string | null {
  const trimmed = base?.trim().replace(/\/+$/, "") ?? "";
  if (!trimmed || !key) return null;
  return `${trimmed}/${key}`;
}
