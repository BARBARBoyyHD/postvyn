/**
 * The platform rules, applied.
 *
 * Two pure functions and no I/O. Everything here is testable from a table of real captions, which is
 * the point: a validator that needs a database to exercise is a validator nobody tests at the edges.
 *
 * The verdict vocabulary is deliberately three-valued. `blocked` is reserved for what a platform would
 * reject — over the ceiling, too many media items, a file too large, a missing title. Everything else
 * warns, because over-blocking teaches the operator to route around the tool.
 */
import { ruleFor, type PlatformRule } from "./platforms";
import {
  utf8Bytes,
  youtubeDescription,
  youtubeTags,
  youtubeTagsLength,
} from "./youtube-rules";

export type SpecLevel = "ok" | "warn" | "blocked";

export interface SpecIssue {
  field: "title" | "caption" | "hashtags" | "media";
  level: Exclude<SpecLevel, "ok">;
  message: string;
}

export interface MediaFacts {
  bytes: number;
  width: number | null;
  height: number | null;
  mime: string;
  postable: boolean;
}

export interface CountResult {
  counted: number;
  ceiling: number | null;
  remaining: number | null;
  /** The platform's own unit: characters for most, UTF-8 bytes for YouTube's description. */
  unit: "characters" | "bytes";
}

/**
 * Count the way the platform counts.
 *
 * Three rules that are not "length of the string":
 *  - YouTube's description is measured in UTF-8 bytes, over the caption *and* the tags it carries;
 *  - Threads spends one budget on caption *and* hashtags;
 *  - Instagram counts the caption only, because its hashtags live in the first comment by choice.
 *
 * No supported platform prices a link — X, which did, left the lineup on 2026-11-17 — so a URL is
 * counted as its own characters everywhere.
 */
export function countFor(
  platform: string,
  caption: string,
  hashtags: readonly string[],
): CountResult {
  const rule = ruleFor(platform);
  if (!rule) {
    return { counted: caption.length, ceiling: null, remaining: null, unit: "characters" };
  }

  const unit = rule.captionUnit;
  const counted = rule.captionUnit === "bytes"
    ? utf8Bytes(youtubeDescription(caption, hashtags))
    : caption.length +
      (rule.hashtagsShareCaptionBudget && hashtags.length > 0
        ? 1 + hashtags.reduce((total, tag) => total + normaliseTag(tag).length, 0)
        : 0);

  const ceiling = rule.captionCeiling;
  return {
    counted,
    ceiling,
    remaining: ceiling === null ? null : ceiling - counted,
    unit,
  };
}

/** The verdict for one variant. Warnings need a reason from a human; blocks need an edit. */
export function validate(
  platform: string,
  input: {
    /** The post's title; YouTube's `snippet.title`. Omitted where the caller has no title yet. */
    title?: string;
    caption: string;
    hashtags: readonly string[];
    media: readonly MediaFacts[];
  },
): { state: SpecLevel; issues: SpecIssue[]; count: CountResult; rule: PlatformRule | null } {
  const rule = ruleFor(platform);
  const count = countFor(platform, input.caption, input.hashtags);

  // Fail closed: a platform with no rule set is a bug in the generator, not a licence to publish.
  if (!rule) {
    return {
      state: "blocked",
      issues: [
        {
          field: "caption",
          level: "blocked",
          message: `No rule set for "${platform}" — run pnpm specs:generate`,
        },
      ],
      count,
      rule: null,
    };
  }

  const issues: SpecIssue[] = [];

  if (rule.titleCeiling !== null && input.title !== undefined) {
    const title = input.title.trim();
    if (title.length === 0) {
      issues.push({
        field: "title",
        level: "blocked",
        message: `${platform} needs a title, and this post has none — ${rule.titleCeiling} characters at most`,
      });
    } else if (title.length > rule.titleCeiling) {
      issues.push({
        field: "title",
        level: "blocked",
        message: `${title.length} characters, ${platform} accepts ${rule.titleCeiling}`,
      });
    }
  }

  if (count.ceiling !== null && count.counted > count.ceiling) {
    issues.push({
      field: "caption",
      level: "blocked",
      message: `${count.counted} ${count.unit}, ${platform} accepts ${count.ceiling}`,
    });
  }

  const tags = input.hashtags.length;
  if (rule.tagsCeiling !== null) {
    const measured = youtubeTagsLength(youtubeTags(input.hashtags));
    if (measured > rule.tagsCeiling) {
      issues.push({
        field: "hashtags",
        level: "blocked",
        message:
          `${measured} characters of tags, ${platform} accepts ${rule.tagsCeiling} for the whole list ` +
          `(commas and quotes included)`,
      });
    }
  }
  if (rule.hashtags.max !== null && tags > rule.hashtags.max) {
    issues.push({
      field: "hashtags",
      level: "warn",
      message: `${tags} hashtags — ${platform} works best with ${rule.hashtags.min ?? 0}-${rule.hashtags.max}`,
    });
  }
  if (tags === 0 && rule.hashtags.min !== null) {
    issues.push({
      field: "hashtags",
      level: "warn",
      message: `no hashtags — ${platform} expects ${rule.hashtags.min}-${rule.hashtags.max}`,
    });
  }

  const postable = input.media.filter((item) => item.postable);

  if (rule.mediaKind === "video") {
    const notVideo = postable.filter((item) => !item.mime.startsWith("video/"));
    if (notVideo.length > 0) {
      issues.push({
        field: "media",
        level: "blocked",
        message: `${platform} uploads a video, and ${notVideo.length} of these file(s) are not video`,
      });
    }
  }

  if (rule.mediaMax !== null && postable.length > rule.mediaMax) {
    issues.push({
      field: "media",
      level: "blocked",
      message: `${postable.length} media items, ${platform} accepts ${rule.mediaMax}`,
    });
  }

  if (rule.maxBytesPerImage !== null) {
    const heavy = postable.filter((item) => item.bytes > rule.maxBytesPerImage!);
    if (heavy.length > 0) {
      issues.push({
        field: "media",
        level: "blocked",
        message: `${heavy.length} file(s) over ${Math.round(rule.maxBytesPerImage / (1024 * 1024))} MB`,
      });
    }
  }

  const ruleAspect = rule.preferredAspect;
  if (ruleAspect) {
    const wanted = parseRatio(ruleAspect);
    const off = postable.filter((item) => {
      if (!item.width || !item.height) return false;
      const actual = item.width / item.height;
      return Math.abs(actual - wanted) > 0.02;
    });
    if (off.length > 0) {
      issues.push({
        field: "media",
        level: "warn",
        message: `${off.length} item(s) are not ${ruleAspect} — the platform will crop or letterbox`,
      });
    }
  }

  const state: SpecLevel = issues.some((issue) => issue.level === "blocked")
    ? "blocked"
    : issues.length > 0
      ? "warn"
      : "ok";

  return { state, issues, count, rule };
}

/** `"#TicketsmithCLI"` and `"ticketsmithcli"` are the same tag for budget purposes. */
export function normaliseTag(tag: string): string {
  const trimmed = tag.trim();
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

/** The ratio as a number, so an aspect comparison is one subtraction. */
function parseRatio(ratio: string): number {
  const [w, h] = ratio.split(":").map(Number);
  return w > 0 && h > 0 ? w / h : 1;
}

/** The value stored in `variants.spec_version`: which rules produced this verdict. */
export function specVersionFor(platform: string): string | null {
  const rule = ruleFor(platform);
  if (!rule) return null;
  return `${platform}@${rule.sourceDigest}`;
}
