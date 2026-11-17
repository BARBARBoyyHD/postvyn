/**
 * TikTok is never automated (non-negotiable 5, ADR-008).
 *
 * TikTok's Content Sharing Guidelines name "a utility tool to help upload contents to the account(s)
 * you or your team manages" as unacceptable, so no adapter here will ever post. This one exists so a
 * TikTok variant gets a sentence instead of silence: a missing adapter is rediscovered every sprint,
 * a refusing one says why.
 *
 * What replaces the upload is a pack a human posts in thirty seconds: caption, hashtags, the assets in
 * order, and the checklist. `buildTiktokPack` computes it and touches nothing — the reading of rows
 * and the recording of completion are `src/db/tiktok-pack.ts`.
 */
import type { Publisher, PublishResult } from "./port";

export const TIKTOK_REASON =
  "TikTok is not automatable: its guidelines reject a utility that uploads to accounts you manage " +
  "(docs/001-PRD.md §8, ADR-008). A manual pack is the only path.";

/** What a pack says about one file. `path` is what is stored; `url` exists only when one can be built. */
export interface TiktokAsset {
  mediaId: string;
  kind: "image" | "video";
  /** An R2 object key, or a vault path for a media row imported from v0.1 — never a guess. */
  path: string;
  /** A public address for the same file; null when no base is configured or the row is not in R2. */
  url: string | null;
}

export interface TiktokPack {
  caption: string;
  hashtags: string[];
  /** In publish order: the operator uploads them in this sequence. */
  assets: TiktokAsset[];
  checklist: string[];
  /** One line, because a limitation nobody explains is a limitation somebody works around. */
  reason: string;
}

/**
 * Everything the operator needs, from values already read — no database, no network.
 *
 * The assets come in the variant's order, because that order is the content (the same reason the
 * approval hash covers media order).
 */
export function buildTiktokPack(input: {
  caption: string;
  hashtags: readonly string[];
  assets: readonly TiktokAsset[];
}): TiktokPack {
  return {
    caption: input.caption,
    hashtags: [...input.hashtags],
    assets: [...input.assets],
    checklist: [
      "Open TikTok and start a new post.",
      "Upload the assets in the order listed above — TikTok keeps the order you pick them in.",
      "Paste the caption, then the hashtags.",
      "Check the hook is on the video itself in the first 1-2 seconds, not only in the caption.",
      "Post it, then copy the post's URL and record it here: nothing counts as published until you do.",
    ],
    reason: TIKTOK_REASON,
  };
}

/** The guideline reason for a platform, or null when the platform publishes itself. */
export function manualReason(platform: string): string | null {
  return platform === "tiktok" ? TIKTOK_REASON : null;
}

export function tiktokRefusal(): Publisher {
  return {
    platform: "tiktok",
    async preview() {
      return { calls: [], estimatedCostUsd: null, notes: [TIKTOK_REASON] };
    },
    async publish() {
      return { status: "not_connected", reason: TIKTOK_REASON };
    },
    async verify(result): Promise<PublishResult> {
      return result;
    },
  };
}
