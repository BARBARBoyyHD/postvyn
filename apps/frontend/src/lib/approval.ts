/**
 * What an approval is bound to.
 *
 * The hash covers **everything that leaves the building**: caption, hashtags in order, media in order.
 * Not the title, not the pillar — those never reach a platform, and including them would make a typo in
 * an internal note invalidate a scheduled post.
 *
 * It is recomputed at claim time as well as at approve time. An approval that was valid an hour ago says
 * nothing about the row now, and the claim-time check is the one that actually protects the operator.
 */
export interface HashableVariant {
  caption: string | null;
  hashtags: string | null; // JSON array
  mediaIds: string | null; // JSON array, order significant
}

export async function variantHash(variant: HashableVariant): Promise<string> {
  // Stable separators: a caption ending in "a" plus a tag "#b" must not hash the same as "a#b" plus "".
  const payload = [
    variant.caption ?? "",
    JSON.stringify(parseList(variant.hashtags)),
    JSON.stringify(parseList(variant.mediaIds)),
  ].join("\u0000");

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The same hash, from the pieces rather than a row — used by tests and by the publish path. */
export async function hashParts(
  caption: string,
  hashtags: readonly string[],
  mediaIds: readonly string[],
): Promise<string> {
  return variantHash({
    caption,
    hashtags: JSON.stringify(hashtags),
    mediaIds: JSON.stringify(mediaIds),
  });
}

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
