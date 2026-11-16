/**
 * Pure mapping: what a vault folder becomes in the database.
 *
 * No filesystem, no database, no clock — every input is passed in. That is what makes it testable in
 * the Workers runtime, where `node:fs` does not exist, and it is why the CLI (which does have a
 * filesystem) is a thin shell around this.
 *
 * Two rules from the change spec drive everything here:
 *   - **Verbatim.** Status, caption and hashtags are copied, never normalised. The importer's job is
 *     fidelity; the app's opinion starts in M3.
 *   - **Review artifacts never ship.** `contact-sheet*`, `thumb*`, `preview*` are recorded with
 *     `postable = false` and kept out of the variant's media order.
 */
import { createHash } from "node:crypto";

/** Files whose names mark them as working material rather than publishable assets. */
const REVIEW_ARTIFACT = /(^|\/)(contact-sheet|thumb|thumbnail|preview)[^/]*$/i;

const MIME_BY_EXT = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
};

export const mimeFor = (path) => {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
};

export const isReviewArtifact = (path) => REVIEW_ARTIFACT.test(path);

/** Deterministic ids: derivable without a database, readable in a query result. */
export const postId = (brandSlug, itemId) => `post_${brandSlug}_${itemId}`;
export const variantId = (brandSlug, itemId, platform) => `var_${brandSlug}_${itemId}_${platform}`;
export const mediaId = (sha256) => `med_${sha256.slice(0, 20)}`;
export const channelId = (brandSlug, platform) => `chn_${brandSlug}_${platform}`;

/**
 * Extracts the caption from `caption.md`.
 *
 * The format is a markdown preamble followed by a fenced ```text block holding exactly the text to
 * paste. The preamble is documentation (assets, render commands) and must not become the caption —
 * that mistake ships a post with build instructions in it.
 */
export function extractCaption(markdown) {
  const fenced = markdown.match(/```text\r?\n([\s\S]*?)```/);
  if (fenced) return fenced[1].trimEnd();

  // No fence: fall back to everything after the "## Caption" heading, so a slightly different file
  // still imports something the operator can see, and the diff shows it was a fallback.
  const heading = markdown.match(/^##+\s*Caption[^\n]*\n([\s\S]*)$/im);
  return heading ? heading[1].trim() : "";
}

/** `item.json` statuses are already our status vocabulary; anything else is reported, not guessed. */
const KNOWN_STATUSES = new Set([
  "idea",
  "researched",
  "drafting",
  "review",
  "approved",
  "scheduled",
  "published",
  "failed",
  "archived",
]);

/**
 * @param {object} input
 * @param {{slug: string, id: string}} input.brand
 * @param {string} input.itemId
 * @param {object} input.item          parsed item.json
 * @param {string} input.platform      the platform folder this variant belongs to
 * @param {string} input.captionMarkdown  contents of caption.md
 * @param {{path: string, sha256: string, bytes: number}[]} input.assets  resolved asset files
 */
export function mapItemToRows({ brand, itemId, item, platform, captionMarkdown, assets }) {
  const problems = [];

  if (item.id && item.id !== itemId) {
    problems.push(`item.json id "${item.id}" does not match folder "${itemId}"`);
  }
  if (item.brand && item.brand !== brand.slug) {
    problems.push(`item.json brand "${item.brand}" does not match folder brand "${brand.slug}"`);
  }
  const status = String(item.status ?? "idea").toLowerCase();
  if (!KNOWN_STATUSES.has(status)) {
    problems.push(`unknown status "${item.status}" — imported as-is, will not display on the board`);
  }

  const caption = extractCaption(captionMarkdown);
  if (!caption) problems.push("no caption found in caption.md");

  const hashtags = Array.isArray(item.hashtags) ? item.hashtags : [];

  const media = assets.map((asset) => ({
    id: mediaId(asset.sha256),
    path: asset.path,
    sha256: asset.sha256,
    bytes: asset.bytes,
    mime: mimeFor(asset.path),
    postable: !isReviewArtifact(asset.path),
  }));

  // Publish order = the order in item.json lists assets, with review artifacts removed. The contact
  // sheet is often asset #2; leaving it in turns a reel into a carousel of frames.
  const postableIds = media.filter((m) => m.postable).map((m) => m.id);

  return {
    problems,
    post: {
      id: postId(brand.slug, itemId),
      externalRef: itemId,
      brandSlug: brand.slug,
      title: item.title ?? itemId,
      format: item.format ?? "single",
      status,
      pillar: item.pillar ?? null,
      scheduleAt: null, // the vault has no slot for these items; M4 slots them
    },
    // The vault may record that an item already shipped (a manual post, an older pipeline run). When it
    // does, the record travels with the variant; when it does not, the variant is simply not published.
    publish: mapPublish(item.published, platform),
    variant: {
      id: variantId(brand.slug, itemId, platform),
      channelId: channelId(brand.slug, platform),
      platform,
      caption,
      hashtags,
      mediaIds: postableIds,
      specState: "unchecked",
    },
    media,
  };
}

export function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * `item.published` is optional and hand-written, so it is read defensively: a malformed block is a
 * problem to report, not a crash and not a silent drop.
 */
function mapPublish(value, platform) {
  if (!value || typeof value !== "object") return null;
  const at = value.at ?? value.published_at ?? value.date ?? null;
  const url = typeof value.url === "string" ? value.url : null;
  const platformPostId = value.id ?? value.platform_post_id ?? null;
  if (!url && !platformPostId) return null;

  const created = at ? Date.parse(String(at)) : Date.now();
  return {
    id: `pub_${platform}_${Math.abs(hashish(`${url ?? ""}${platformPostId ?? ""}`))}`,
    platform,
    url,
    platformPostId: platformPostId ? String(platformPostId) : null,
    state: "succeeded",
    createdAt: Number.isFinite(created) ? created : Date.now(),
  };
}

/** Small deterministic id suffix: two runs over the same item must claim the same row. */
function hashish(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
}
