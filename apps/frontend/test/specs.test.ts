/**
 * The platform rules, tested against the rules themselves.
 *
 * Every case here is a sentence someone wrote in `social/<platform>/specs.md`. If a case fails, either
 * the parser stopped reading that sentence or the sentence changed — both worth failing on.
 */
import { describe, expect, it } from "vitest";

import { PLATFORM_RULES, ruleFor } from "@/lib/specs/platforms";
import { countFor, normaliseTag, specVersionFor, validate } from "@/lib/specs/validate";

/** The real Instagram caption from the vault — the fixture that proved the importer byte-exact. */
const REAL_IG_CAPTION =
  "We do not sell websites. We sell the thing you actually wanted when you asked for one: " +
  "a system that answers the phone at 2am, prices a job without a spreadsheet, and tells you " +
  "on Monday what happened last week. Three things we build, in the order people ask for them. " +
  "One: a site that loads in under a second and says what you do in one sentence. " +
  "Two: the internal tool that replaces the WhatsApp group. Three: the automation nobody " +
  "notices because it just works.";

describe("the generated rule set is the one the specs describe", () => {
  it("reads all four platforms", () => {
    expect(Object.keys(PLATFORM_RULES).sort()).toEqual(["instagram", "threads", "tiktok", "x"]);
  });

  it("carries each platform's own ceiling", () => {
    expect(ruleFor("instagram")?.captionCeiling).toBe(2200);
    expect(ruleFor("threads")?.captionCeiling).toBe(500);
    expect(ruleFor("x")?.captionCeiling).toBe(280);
    expect(ruleFor("tiktok")?.captionCeiling).toBe(2200);
  });

  it("knows which platforms share the caption budget with hashtags", () => {
    expect(ruleFor("threads")?.hashtagsShareCaptionBudget).toBe(true);
    expect(ruleFor("instagram")?.hashtagsShareCaptionBudget).toBe(false);
  });

  it("knows X's fixed link cost, because X does not measure the URL", () => {
    expect(ruleFor("x")?.linkCost).toBe(23);
  });

  it("knows the media ceilings", () => {
    expect(ruleFor("instagram")?.mediaMax).toBe(20);
    expect(ruleFor("threads")?.mediaMax).toBe(10);
    expect(ruleFor("x")?.mediaMax).toBe(4);
  });

  it("records the source digest, so a stale copy is detectable", () => {
    for (const rule of Object.values(PLATFORM_RULES)) {
      expect(rule.sourceDigest).toMatch(/^[0-9a-f]{12}$/);
      expect(rule.sourcePath).toMatch(/^social\/[a-z]+\/specs\.md$/);
      expect(specVersionFor(rule.platform)).toBe(`${rule.platform}@${rule.sourceDigest}`);
    }
  });
});

describe("counting is the platform's arithmetic, not string length", () => {
  it("counts a plain caption as its length", () => {
    expect(countFor("instagram", "hello", []).counted).toBe(5);
  });

  it("replaces an X link with 23 characters regardless of its length", () => {
    const url = "https://example.com/a/very/long/path/that/is/definitely/longer/than/23";
    const caption = `read this ${url}`;
    const result = countFor("x", caption, []);
    expect(result.counted).toBe("read this ".length + 23);
    expect(result.linkSubstituted).toBe(true);
  });

  it("spends one budget on Threads' caption and hashtags", () => {
    const without = countFor("threads", "hello", []);
    const withTags = countFor("threads", "hello", ["one", "two"]);
    expect(withTags.counted).toBe(without.counted + 1 + "#one".length + "#two".length);
  });

  it("leaves Instagram's hashtags out of the caption count — they live in the first comment", () => {
    expect(countFor("instagram", "hello", ["one", "two"]).counted).toBe(5);
  });

  it("normalises a hashtag once, so '#x' and 'x' cost the same", () => {
    expect(normaliseTag("x")).toBe("#x");
    expect(normaliseTag("#x")).toBe("#x");
    expect(countFor("threads", "", ["x"]).counted).toBe(countFor("threads", "", ["#x"]).counted);
  });

  it("reports what is left rather than only what is used", () => {
    const result = countFor("x", "abc", []);
    expect(result.remaining).toBe(277);
  });
});

describe("the verdict separates 'the platform would refuse' from 'a human should look'", () => {
  it("accepts the real Instagram caption", () => {
    const verdict = validate("instagram", { caption: REAL_IG_CAPTION, hashtags: ["a", "b", "c"], media: [] });
    expect(verdict.state).toBe("ok");
    expect(verdict.issues).toEqual([]);
  });

  it("blocks a caption over the ceiling", () => {
    const verdict = validate("x", { caption: "a".repeat(281), hashtags: ["one"], media: [] });
    expect(verdict.state).toBe("blocked");
    expect(verdict.issues[0]).toMatchObject({ field: "caption", level: "blocked" });
  });

  it("warns, but does not block, on too many hashtags", () => {
    const verdict = validate("x", { caption: "ok", hashtags: ["a", "b", "c", "d"], media: [] });
    expect(verdict.state).toBe("warn");
    expect(verdict.issues[0]).toMatchObject({ field: "hashtags", level: "warn" });
  });

  it("warns when a platform that expects hashtags gets none", () => {
    const verdict = validate("instagram", { caption: "ok", hashtags: [], media: [] });
    expect(verdict.issues.some((issue) => issue.field === "hashtags")).toBe(true);
  });

  it("blocks more media than the platform accepts", () => {
    const media = Array.from({ length: 5 }, () => ({
      bytes: 1000,
      width: 1600,
      height: 900,
      mime: "image/jpeg",
      postable: true,
    }));
    const verdict = validate("x", { caption: "ok", hashtags: ["one"], media });
    expect(verdict.state).toBe("blocked");
    expect(verdict.issues.some((issue) => issue.message.includes("media items"))).toBe(true);
  });

  it("does not count reference-only media against the ceiling", () => {
    const media = Array.from({ length: 5 }, () => ({
      bytes: 1000,
      width: 1600,
      height: 900,
      mime: "image/jpeg",
      postable: false,
    }));
    const verdict = validate("x", { caption: "ok", hashtags: ["one"], media });
    expect(verdict.state).toBe("ok");
  });

  it("blocks a file over the platform's size limit", () => {
    const verdict = validate("instagram", {
      caption: "ok",
      hashtags: ["one", "two", "three"],
      media: [{ bytes: 5 * 1024 * 1024, width: 1080, height: 1350, mime: "image/jpeg", postable: true }],
    });
    expect(verdict.state).toBe("blocked");
  });

  it("warns when the aspect ratio is not the preferred one", () => {
    const verdict = validate("instagram", {
      caption: "ok",
      hashtags: ["one", "two", "three"],
      media: [{ bytes: 1000, width: 1080, height: 1080, mime: "image/jpeg", postable: true }],
    });
    expect(verdict.state).toBe("warn");
    expect(verdict.issues.some((issue) => issue.message.includes("9:16"))).toBe(true);
  });

  it("fails closed for a platform with no rule set", () => {
    const verdict = validate("myspace", { caption: "hi", hashtags: [], media: [] });
    expect(verdict.state).toBe("blocked");
    expect(verdict.issues[0].message).toContain("pnpm specs:generate");
  });
});
