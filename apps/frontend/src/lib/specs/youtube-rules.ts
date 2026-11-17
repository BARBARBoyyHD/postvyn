/**
 * YouTube's metadata limits, hand-authored because they come from the API reference rather than from
 * the content repo's `social/<platform>/specs.md`.
 *
 * `platforms.ts` is generated from that markdown for Instagram, Threads and TikTok. YouTube has no such
 * file to parse — its numbers are quoted from the `videos` resource reference, so they live here, named,
 * with their source and read date on each one (design decision 6; spec-engine: "Every number SHALL be a
 * named constant carrying its source and read date").
 *
 * The description text is built here as well, for the same reason the numbers are: the counter and the
 * adapter must measure and send the same string. Two spellings of "caption + hashtags" is how a post
 * that the gate passed gets rejected by the platform.
 */
import type { PlatformRule } from "./platforms";

// Source: YouTube Data API v3 `videos` resource reference,
// developers.google.com/youtube/data/reference/rest/v3/videos, last updated 2026-11-17, read 2026-11-17:
// `snippet.title` — "maximum length of 100 characters".
export const YOUTUBE_TITLE_MAX_CHARS = 100;

// Source: same reference, same read date: `snippet.description` — "maximum length of 5000 bytes". The
// API counts bytes, not characters; YouTube Help's "5,000 characters" is the loose retelling and the API
// is the validator (spec-engine: "The description is counted in bytes, not characters").
export const YOUTUBE_DESCRIPTION_MAX_BYTES = 5000;

// Source: same reference, same read date: `snippet.tags[]` — "maximum length of 500 characters" for the
// whole list, with the commas between items counted and `"a spaced tag"` counted as if quoted.
export const YOUTUBE_TAGS_MAX_CHARS = 500;

// One video file per upload: `videos.insert` takes a single media body (same reference, same read date).
export const YOUTUBE_MEDIA_MAX = 1;

// Source: YouTube Help, "Understand three-minute YouTube Shorts",
// support.google.com/youtube/answer/15424877, read 2026-11-17: videos uploaded after 2024-10-15 that are
// square or vertical and no longer than three minutes are Shorts; wider or longer files are long-form.
export const YOUTUBE_SHORTS_MAX_MS = 3 * 60 * 1000;

/** The tag that convention puts on a Short. Appended to the description, never used as a rule. */
export const YOUTUBE_SHORTS_TAG = "#Shorts";

/**
 * What YouTube is told about one variant.
 *
 * `notes` is written for the operator: each line is a limit the platform enforces, in the platform's own
 * unit, so the composer can explain a block without the reader opening the API reference.
 */
export const YOUTUBE_RULE: PlatformRule = {
  platform: "youtube",
  captionCeiling: YOUTUBE_DESCRIPTION_MAX_BYTES,
  captionUnit: "bytes",
  titleCeiling: YOUTUBE_TITLE_MAX_CHARS,
  tagsCeiling: YOUTUBE_TAGS_MAX_CHARS,
  hashtags: { min: null, max: null },
  hashtagsShareCaptionBudget: true,
  mediaMax: YOUTUBE_MEDIA_MAX,
  mediaKind: "video",
  maxBytesPerImage: null,
  preferredAspect: null,
  hashtagPlacement: "caption",
  notes: [
    "Title ≤ 100 characters — the post's title is the video title (`snippet.title`)",
    "Description = caption + hashtags, ≤ 5000 bytes of UTF-8 (a multi-byte character costs up to 4)",
    "Tags ≤ 500 characters for the whole list, commas and quotes included",
    "One video per upload; a Short is square or vertical and ≤ 3 minutes — YouTube decides, not a flag",
  ],
  // Not a digest of markdown, because there is no markdown to digest: the version records which
  // reference the numbers were read from.
  sourceDigest: "videos-api-v3",
  sourcePath: "developers.google.com/youtube/data/reference/rest/v3/videos",
};

/** The description YouTube receives: the caption, a blank line, then the tags (they spend its budget). */
export function youtubeDescription(caption: string, hashtags: readonly string[]): string {
  const tags = youtubeTags(hashtags);
  return [
    caption.trim(),
    tags.length > 0 ? tags.map((tag) => `#${tag}`).join(" ") : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The tags as YouTube measures them: `snippet.tags` items without the `#`, a tag containing spaces
 * counted as if quoted (its quotes are part of the 500), and one comma between every pair.
 */
export function youtubeTags(hashtags: readonly string[]): string[] {
  return hashtags
    .map((tag) => tag.trim().replace(/^#/, ""))
    .filter((tag) => tag.length > 0);
}

/** `snippet.tags` is measured as one string, so the ceiling is over this, not over each tag. */
export function youtubeTagsLength(tags: readonly string[]): number {
  if (tags.length === 0) return 0;
  const characters = tags.reduce((total, tag) => total + (/\s/.test(tag) ? tag.length + 2 : tag.length), 0);
  return characters + tags.length - 1;
}

/** Bytes, because YouTube's validator counts bytes. */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Is this file shaped like a Short?
 *
 * Square or vertical, per YouTube's own categorisation. Duration is the other half of the rule and this
 * app measures none, so a caller must say so rather than imply a Short it cannot promise.
 *
 * shortcut: no duration is measured anywhere (media carries width/height only), so classification is
 * aspect alone and the preview says the rest is YouTube's call; upgrade when the media probe reads it.
 */
export function isShortShaped(width: number | null, height: number | null): boolean {
  if (!width || !height) return false;
  return height >= width;
}
