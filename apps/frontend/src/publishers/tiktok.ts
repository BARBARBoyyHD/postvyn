/**
 * TikTok is never automated (non-negotiable 5, ADR-008).
 *
 * TikTok's Content Sharing Guidelines name "a utility tool to help upload contents to the account(s)
 * you or your team manages" as unacceptable, so no adapter here will ever post. This one exists so a
 * TikTok variant gets a sentence instead of silence: a missing adapter is rediscovered every sprint,
 * a refusing one says why.
 *
 * The manual pack that replaces it is §6 of this change; until then the job parks and the board shows
 * the reason.
 */
import type { Publisher, PublishResult } from "./port";

export const TIKTOK_REASON =
  "TikTok is not automatable: its guidelines reject a utility that uploads to accounts you manage " +
  "(docs/001-PRD.md §8, ADR-008). A manual pack is the only path, and it is not built yet.";

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
