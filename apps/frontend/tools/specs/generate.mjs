#!/usr/bin/env node
/**
 * Compile `social/<platform>/specs.md` into a typed rule set.
 *
 * The content repo stays the authoring surface; this repo carries a generated, reviewable copy. Read
 * at build time from a sibling directory instead and CI breaks, because that directory is not part of
 * this repository.
 *
 *   pnpm specs:generate          # rewrite src/lib/specs/platforms.ts
 *   pnpm specs:check             # exit 1 when the committed copy is older than its source
 *
 * The digest is over the raw markdown, so "stale" is a fact, not a date comparison somebody has to
 * remember to update.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const PLATFORMS = ["instagram", "threads", "x", "tiktok"];
const SPECS_ROOT =
  process.env.POSTVYN_SPECS_ROOT ??
  path.resolve("../../../../uwi/Projetcs/Uwi's-Department/social");
const OUT = "src/lib/specs/platforms.ts";

function readSource(platform) {
  const file = path.join(SPECS_ROOT, platform, "specs.md");
  if (!existsSync(file)) {
    console.error(`missing ${file} — set POSTVYN_SPECS_ROOT to the content repo's social/ directory`);
    process.exit(2);
  }
  return { file, raw: readFileSync(file, "utf8") };
}

function parse(platform, markdown) {
  const first = (re, group = 1) => {
    const match = markdown.match(re);
    return match ? Number(match[group]) : null;
  };

  const ceiling = first(/(\d{3,4})\s*chars/i);
  // X's link rule is the one everybody gets wrong: the URL is replaced by a fixed cost, not measured.
  const urlCost = first(/URLs? count as (\d+) chars/i);

  // Ranges are written three different ways in the four files: "Hashtags: 3-5", "3-5 is plenty",
  // "3-5 hashtags". Matching only the first form silently produced `null` for two platforms.
  const hashtagRange = [
    /Hashtags?:?\s*(\d+)\s*[-–]\s*(\d+)/i,
    /(\d+)\s*[-–]\s*(\d+)\s*hashtags/i,
    /Hashtags?[^.]*?(\d+)\s*[-–]\s*(\d+)/i,
  ]
    .map((re) => markdown.match(re))
    .find(Boolean);
  const hashtagMax = hashtagRange ? Number(hashtagRange[2]) : first(/Hashtags?:?\s*(\d+)\s*max/i);

  const mediaMax =
    first(/up to (\d+) slides/i) ??
    first(/Up to (\d+) images/i) ??
    first(/up to (\d+) images/i) ??
    first(/Multi-image \(max (\d+)\)/i) ??
    first(/max (\d+) image/i);

  const maxBytes = first(/(\d+)\s*MB per image/i);
  const sharesBudget = /share the budget/i.test(markdown);

  const aspect = first(/(\d+)\s*x\s*(\d+)\s*\((\d+):(\d+)\)/i, 3)
    ? `${markdown.match(/(\d+)\s*x\s*(\d+)\s*\((\d+):(\d+)\)/i)[3]}:${
        markdown.match(/(\d+)\s*x\s*(\d+)\s*\((\d+):(\d+)\)/i)[4]
      }`
    : null;

  const notes = markdown
    .split("\n")
    .filter((line) => /^- /.test(line))
    .map((line) => line.replace(/^- /, "").trim());

  return {
    platform,
    captionCeiling: ceiling,
    hashtags: { min: hashtagRange ? Number(hashtagRange[1]) : null, max: hashtagMax },
    hashtagsShareCaptionBudget: sharesBudget,
    mediaMax,
    maxBytesPerImage: maxBytes ? maxBytes * 1024 * 1024 : null,
    preferredAspect: aspect,
    // Where the hashtags go: Instagram's live in the first comment by choice, the others inline.
    hashtagPlacement: platform === "instagram" ? "first_comment" : "caption",
    linkCost: urlCost,
    notes,
  };
}

const sources = PLATFORMS.map((platform) => {
  const { file, raw } = readSource(platform);
  return {
    platform,
    rule: parse(platform, raw),
    digest: createHash("sha256").update(raw).digest("hex").slice(0, 12),
    relative: path.relative(process.cwd(), file).split(path.sep).join("/"),
  };
});

const generatedAt = new Date().toISOString().slice(0, 10);

const map = Object.fromEntries(
  sources.map(({ platform, rule, digest }) => [
    platform,
    { ...rule, sourceDigest: digest, sourcePath: `social/${platform}/specs.md` },
  ]),
);

const body = `/**
 * GENERATED — do not edit by hand. Run \`pnpm specs:generate\`.
 *
 * Source: \`social/<platform>/specs.md\` in the content repo (Uwi's-Department).
 * Generated: ${generatedAt}
 * Digests:   ${sources.map((s) => `${s.platform}=${s.digest}`).join("  ")}
 *
 * Each digest is over that platform's raw markdown, so \`pnpm specs:check\` can answer "is this copy
 * still true" without a human comparing two files by eye.
 */

export type Platform = ${PLATFORMS.map((p) => `"${p}"`).join(" | ")};

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

export const PLATFORM_RULES: Record<Platform, PlatformRule> = ${JSON.stringify(map, null, 2)};

export const PLATFORMS: Platform[] = ${JSON.stringify(PLATFORMS)};

export function ruleFor(platform: string): PlatformRule | null {
  return (PLATFORM_RULES as Record<string, PlatformRule>)[platform] ?? null;
}

export const SPEC_SOURCE = {
  root: "social/<platform>/specs.md (content repo)",
  generatedAt: "${generatedAt}",
  digests: { ${sources.map((s) => `${s.platform}: "${s.digest}"`).join(", ")} },
} as const;
`;

const digestLine = (text) => (text.match(/Digests:\s+(.+)/) ?? [])[1]?.trim();

const nextDigests = sources.map((s) => `${s.platform}=${s.digest}`).join("  ");

if (process.argv.includes("--check")) {
  if (!existsSync(OUT)) {
    console.error(`${OUT} does not exist — run pnpm specs:generate`);
    process.exit(1);
  }
  const current = digestLine(readFileSync(OUT, "utf8"));
  if (current !== nextDigests) {
    console.error("the committed rule set is older than its source:");
    console.error(`  committed  ${current}`);
    console.error(`  source now ${nextDigests}`);
    console.error("run pnpm specs:generate and review the diff");
    process.exit(1);
  }
  console.log(`specs:check ✓ (${nextDigests})`);
  process.exit(0);
}

writeFileSync(OUT, body, "utf8");
console.log(`wrote ${OUT}`);
for (const { rule } of sources) {
  console.log(
    `  ${rule.platform.padEnd(10)} ceiling ${String(rule.captionCeiling).padStart(4)}` +
      ` · tags ${rule.hashtags.min}-${rule.hashtags.max}` +
      ` · media ${rule.mediaMax}` +
      `${rule.linkCost ? ` · link ${rule.linkCost}` : ""}` +
      `${rule.hashtagsShareCaptionBudget ? " · shared budget" : ""}`,
  );
}
