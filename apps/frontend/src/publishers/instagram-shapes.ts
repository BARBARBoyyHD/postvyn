/**
 * Instagram's three media shapes, and the requirements Meta puts on each.
 *
 * One reason to change: Meta's publishing rules. Kept away from the flow in `instagram.ts` for the same
 * reason the spec engine is away from the adapters — data that is checked and data that is sent change
 * on different evidence.
 */
import { PLATFORM_RULES } from "@/lib/specs/platforms";

import type { PlatformError, PublishMedia } from "./port";

export type InstagramShapeName = "IMAGE" | "REELS" | "CAROUSEL";

export interface InstagramShape {
  /** Meta rejects a container outside these counts (Instagram Content Publishing API, read 2026-11). */
  mediaMin: number;
  mediaMax: number | null;
  /** `media_type` on the container call; null means the single-item shape is inferred by Meta. */
  mediaType: "REELS" | "CAROUSEL" | null;
  kinds: readonly PublishMedia["kind"][];
}

/**
 * The carousel ceiling is not repeated here: it is the spec engine's Instagram `mediaMax`, generated
 * from `social/instagram/specs.md`, so the rule the gate checks and the container the adapter builds
 * cannot disagree.
 */
export const INSTAGRAM_SHAPES: Record<InstagramShapeName, InstagramShape> = {
  IMAGE: { mediaMin: 1, mediaMax: 1, mediaType: null, kinds: ["image"] },
  REELS: { mediaMin: 1, mediaMax: 1, mediaType: "REELS", kinds: ["video"] },
  CAROUSEL: {
    mediaMin: 2,
    mediaMax: PLATFORM_RULES.instagram.mediaMax,
    mediaType: "CAROUSEL",
    kinds: ["image", "video"],
  },
};

/** The shape a variant's media selects, or null when there is nothing to post. */
export function shapeFor(media: readonly PublishMedia[]): InstagramShapeName | null {
  if (media.length === 0) return null;
  if (media.length === 1) return media[0].kind === "video" ? "REELS" : "IMAGE";
  return "CAROUSEL";
}

/** Why a variant does not fit the shape it selected. Null when it fits. */
export function shapeProblem(
  shape: InstagramShapeName,
  media: readonly PublishMedia[],
): PlatformError | null {
  const rule = INSTAGRAM_SHAPES[shape];

  if (media.length < rule.mediaMin) {
    return {
      code: "media_required",
      message: `${shape} needs at least ${rule.mediaMin} media item(s), and the variant has ${media.length}`,
    };
  }
  if (rule.mediaMax !== null && media.length > rule.mediaMax) {
    return {
      code: "too_many_media",
      message: `${shape} takes at most ${rule.mediaMax} media items, and the variant has ${media.length}`,
    };
  }

  const wrong = media.find((item) => !rule.kinds.includes(item.kind));
  if (wrong) {
    return {
      code: "media_unsupported",
      message: `${shape} takes ${rule.kinds.join(" or ")}, and media ${wrong.id} is ${wrong.kind}`,
    };
  }
  return null;
}

/** One line the operator can read in the dry run: which shape this publish will use. */
export function shapeNotes(shape: InstagramShapeName | null): string[] {
  if (!shape) return ["no media: Instagram cannot publish this variant as it stands"];
  const rule = INSTAGRAM_SHAPES[shape];
  const count =
    rule.mediaMax === null ? `${rule.mediaMin} or more` : `${rule.mediaMin}–${rule.mediaMax}`;
  return [`shape ${shape}: ${rule.kinds.join(" or ")}, ${count} item(s)`];
}
