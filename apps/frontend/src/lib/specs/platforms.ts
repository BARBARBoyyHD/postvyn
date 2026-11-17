/**
 * GENERATED — do not edit by hand. Run `pnpm specs:generate`.
 *
 * Source: `social/<platform>/specs.md` in the content repo (Uwi's-Department), for Instagram, Threads
 * and TikTok. YouTube's limits come from the API reference instead and are authored in
 * `youtube-rules.ts`; this file only assembles the map the rest of the app reads.
 *
 * Generated: 2026-11-17
 * Digests:   instagram=25fcfd6bc8f8  threads=11b7a7b5bec1  tiktok=4da796af4491
 *
 * Each digest is over that platform's raw markdown, so `pnpm specs:check` can answer "is this copy
 * still true" without a human comparing two files by eye.
 */
import { YOUTUBE_RULE } from "./youtube-rules";

export type Platform = "instagram" | "threads" | "youtube" | "tiktok";

export interface PlatformRule {
  platform: Platform;
  /** Platform's own caption ceiling, in `captionUnit`. */
  captionCeiling: number | null;
  /** How the platform counts the caption: characters, or UTF-8 bytes (YouTube's API counts bytes). */
  captionUnit: "characters" | "bytes";
  /** The post's title where the platform has one as the video's title (YouTube `snippet.title`). */
  titleCeiling: number | null;
  /** The tag list's whole length in characters, commas and quotes included (YouTube: 500). */
  tagsCeiling: number | null;
  hashtags: { min: number | null; max: number | null };
  /** Threads: hashtags live inside the caption, so they spend the same budget. */
  hashtagsShareCaptionBudget: boolean;
  mediaMax: number | null;
  /** What the platform accepts: anything postable, or video only (YouTube uploads one video). */
  mediaKind: "any" | "video";
  maxBytesPerImage: number | null;
  preferredAspect: string | null;
  hashtagPlacement: "caption" | "first_comment";
  notes: string[];
  /** sha256 of the source markdown this rule was parsed from — or the API reference, for YouTube. */
  sourceDigest: string;
  sourcePath: string;
}

export const PLATFORM_RULES: Record<Platform, PlatformRule> = {
  "instagram": {
    "platform": "instagram",
    "captionCeiling": 2200,
    "captionUnit": "characters",
    "titleCeiling": null,
    "tagsCeiling": null,
    "hashtags": {
      "min": 3,
      "max": 5
    },
    "hashtagsShareCaptionBudget": false,
    "mediaMax": 20,
    "mediaKind": "any",
    "maxBytesPerImage": 4194304,
    "preferredAspect": "9:16",
    "hashtagPlacement": "first_comment",
    "notes": [
      "Max 2200 chars; ~125 visible before \"...more\"",
      "Hashtags: 3-5 relevant beats 30 generic; can go first comment",
      "First line = the hook (it decides the \"...more\" click)",
      "PNG/JPG, keep under 4 MB per image; sRGB",
      "Template target: `image/templates/poster`, `image/templates/carousel`"
    ],
    "sourceDigest": "25fcfd6bc8f8",
    "sourcePath": "social/instagram/specs.md"
  },
  "threads": {
    "platform": "threads",
    "captionCeiling": 500,
    "captionUnit": "characters",
    "titleCeiling": null,
    "tagsCeiling": null,
    "hashtags": {
      "min": 3,
      "max": 5
    },
    "hashtagsShareCaptionBudget": true,
    "mediaMax": 10,
    "mediaKind": "any",
    "maxBytesPerImage": null,
    "preferredAspect": null,
    "hashtagPlacement": "caption",
    "notes": [
      "500 chars total (caption + hashtags share the budget)",
      "Hashtags work as topic links; 3-5 is plenty",
      "Tone: more conversational than IG; replies drive reach",
      "Official Threads API exists (Meta dev app + app review required) - via Postiz or manual until wired"
    ],
    "sourceDigest": "11b7a7b5bec1",
    "sourcePath": "social/threads/specs.md"
  },
  "tiktok": {
    "platform": "tiktok",
    "captionCeiling": 2200,
    "captionUnit": "characters",
    "titleCeiling": null,
    "tagsCeiling": null,
    "hashtags": {
      "min": 3,
      "max": 5
    },
    "hashtagsShareCaptionBudget": false,
    "mediaMax": 35,
    "mediaKind": "any",
    "maxBytesPerImage": null,
    "preferredAspect": "9:16",
    "hashtagPlacement": "caption",
    "notes": [
      "2200 chars via API title field; 3-5 hashtags",
      "Hook text ON the video in the first 1-2 seconds - caption is secondary",
      "Content Posting API requires app **audit**; unaudited apps can only post `SELF_ONLY` (private)",
      "TikTok guidelines explicitly reject \"a utility tool to help upload contents to the",
      "**Therefore:** TikTok ships via TikTok's built-in scheduler or an approved service",
      "Remotion output: 30 fps, 1080x1920, keep text 10% from edges (UI overlay zone)"
    ],
    "sourceDigest": "4da796af4491",
    "sourcePath": "social/tiktok/specs.md"
  },
  "youtube": YOUTUBE_RULE
};

export const PLATFORMS: Platform[] = ["instagram","threads","tiktok","youtube"];

export function ruleFor(platform: string): PlatformRule | null {
  return (PLATFORM_RULES as Record<string, PlatformRule>)[platform] ?? null;
}

export const SPEC_SOURCE = {
  root: "social/<platform>/specs.md (content repo)",
  generatedAt: "2026-11-17",
  digests: { instagram: "25fcfd6bc8f8", threads: "11b7a7b5bec1", tiktok: "4da796af4491" },
} as const;
