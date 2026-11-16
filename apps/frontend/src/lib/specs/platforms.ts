/**
 * GENERATED — do not edit by hand. Run `pnpm specs:generate`.
 *
 * Source: `social/<platform>/specs.md` in the content repo (Uwi's-Department).
 * Generated: 2026-11-16
 * Digests:   instagram=25fcfd6bc8f8  threads=11b7a7b5bec1  x=a22fbefe7948  tiktok=4da796af4491
 *
 * Each digest is over that platform's raw markdown, so `pnpm specs:check` can answer "is this copy
 * still true" without a human comparing two files by eye.
 */

export type Platform = "instagram" | "threads" | "x" | "tiktok";

export interface PlatformRule {
  platform: Platform;
  /** Platform's own caption ceiling, in characters. */
  captionCeiling: number | null;
  hashtags: { min: number | null; max: number | null };
  /** Threads: hashtags live inside the caption, so they spend the same budget. */
  hashtagsShareCaptionBudget: boolean;
  mediaMax: number | null;
  maxBytesPerImage: number | null;
  preferredAspect: string | null;
  hashtagPlacement: "caption" | "first_comment";
  /** X counts any URL as this many characters regardless of its real length. */
  linkCost: number | null;
  notes: string[];
  /** sha256 of the source markdown this rule was parsed from. */
  sourceDigest: string;
  sourcePath: string;
}

export const PLATFORM_RULES: Record<Platform, PlatformRule> = {
  "instagram": {
    "platform": "instagram",
    "captionCeiling": 2200,
    "hashtags": {
      "min": 3,
      "max": 5
    },
    "hashtagsShareCaptionBudget": false,
    "mediaMax": 20,
    "maxBytesPerImage": 4194304,
    "preferredAspect": "9:16",
    "hashtagPlacement": "first_comment",
    "linkCost": null,
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
    "hashtags": {
      "min": 3,
      "max": 5
    },
    "hashtagsShareCaptionBudget": true,
    "mediaMax": 10,
    "maxBytesPerImage": null,
    "preferredAspect": null,
    "hashtagPlacement": "caption",
    "linkCost": null,
    "notes": [
      "500 chars total (caption + hashtags share the budget)",
      "Hashtags work as topic links; 3-5 is plenty",
      "Tone: more conversational than IG; replies drive reach",
      "Official Threads API exists (Meta dev app + app review required) - via Postiz or manual until wired"
    ],
    "sourceDigest": "11b7a7b5bec1",
    "sourcePath": "social/threads/specs.md"
  },
  "x": {
    "platform": "x",
    "captionCeiling": 280,
    "hashtags": {
      "min": 1,
      "max": 2
    },
    "hashtagsShareCaptionBudget": false,
    "mediaMax": 4,
    "maxBytesPerImage": 5242880,
    "preferredAspect": "16:9",
    "hashtagPlacement": "caption",
    "linkCost": 23,
    "notes": [
      "280 chars (free tier); URLs count as 23 chars regardless of length",
      "Hashtags: 1-2 max, CamelCase (#TicketsmithCLI not #ticketsmithcli)",
      "First line is the whole game - no thread-starter filler",
      "Thread = multiple posts; keep each self-contained"
    ],
    "sourceDigest": "a22fbefe7948",
    "sourcePath": "social/x/specs.md"
  },
  "tiktok": {
    "platform": "tiktok",
    "captionCeiling": 2200,
    "hashtags": {
      "min": 3,
      "max": 5
    },
    "hashtagsShareCaptionBudget": false,
    "mediaMax": 35,
    "maxBytesPerImage": null,
    "preferredAspect": "9:16",
    "hashtagPlacement": "caption",
    "linkCost": null,
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
  }
};

export const PLATFORMS: Platform[] = ["instagram","threads","x","tiktok"];

export function ruleFor(platform: string): PlatformRule | null {
  return (PLATFORM_RULES as Record<string, PlatformRule>)[platform] ?? null;
}

export const SPEC_SOURCE = {
  root: "social/<platform>/specs.md (content repo)",
  generatedAt: "2026-11-16",
  digests: { instagram: "25fcfd6bc8f8", threads: "11b7a7b5bec1", x: "a22fbefe7948", tiktok: "4da796af4491" },
} as const;
