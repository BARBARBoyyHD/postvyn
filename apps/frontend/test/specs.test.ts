/**
 * The platform rules, tested against the rules themselves.
 *
 * Every case here is a sentence someone wrote in `social/<platform>/specs.md` — or, for YouTube, a line
 * of the `videos` resource reference. If a case fails, either the parser stopped reading that sentence,
 * the sentence changed, or the API's own number moved: all worth failing on.
 *
 * X's rule set is gone (it left the lineup on 2026-11-17), so its 280-character ceiling, its 23-character
 * link cost and its four-media limit have no cases here: a rule nobody ships is not worth a test.
 */
import { describe, expect, it } from "vitest";

import { PLATFORM_RULES, ruleFor } from "@/lib/specs/platforms";
import { countFor, normaliseTag, specVersionFor, validate } from "@/lib/specs/validate";
import {
  utf8Bytes,
  youtubeDescription,
  youtubeTags,
  youtubeTagsLength,
} from "@/lib/specs/youtube-rules";

/** The real Instagram caption from the vault — the fixture that proved the importer byte-exact. */
const REAL_IG_CAPTION =
  "We do not sell websites. We sell the thing you actually wanted when you asked for one: " +
  "a system that answers the phone at 2am, prices a job without a spreadsheet, and tells you " +
  "on Monday what happened last week. Three things we build, in the order people ask for them. " +
  "One: a site that loads in under a second and says what you do in one sentence. " +
  "Two: the internal tool that replaces the WhatsApp group. Three: the automation nobody " +
  "notices because it just works.";

const video = { bytes: 1024 * 1024, width: 1080, height: 1920, mime: "video/mp4", postable: true };

describe("the generated rule set is the one the specs describe", () => {
  it("reads all four platforms", () => {
    expect(Object.keys(PLATFORM_RULES).sort()).toEqual(["instagram", "threads", "tiktok", "youtube"]);
  });

  it("carries each platform's own ceiling", () => {
    expect(ruleFor("instagram")?.captionCeiling).toBe(2200);
    expect(ruleFor("threads")?.captionCeiling).toBe(500);
    expect(ruleFor("tiktok")?.captionCeiling).toBe(2200);
    expect(ruleFor("youtube")?.captionCeiling).toBe(5000);
  });

  it("counts YouTube's description in bytes and everyone else's in characters", () => {
    expect(ruleFor("youtube")?.captionUnit).toBe("bytes");
    expect(ruleFor("threads")?.captionUnit).toBe("characters");
    expect(ruleFor("instagram")?.captionUnit).toBe("characters");
  });

  it("gives YouTube a title ceiling and a tag ceiling, and no other platform either", () => {
    expect(ruleFor("youtube")?.titleCeiling).toBe(100);
    expect(ruleFor("youtube")?.tagsCeiling).toBe(500);
    for (const other of ["instagram", "threads", "tiktok"]) {
      expect(ruleFor(other)?.titleCeiling).toBeNull();
      expect(ruleFor(other)?.tagsCeiling).toBeNull();
    }
  });

  it("knows which platforms share the caption budget with hashtags", () => {
    expect(ruleFor("threads")?.hashtagsShareCaptionBudget).toBe(true);
    expect(ruleFor("youtube")?.hashtagsShareCaptionBudget).toBe(true);
    expect(ruleFor("instagram")?.hashtagsShareCaptionBudget).toBe(false);
  });

  it("knows the media ceilings and what each platform accepts", () => {
    expect(ruleFor("instagram")?.mediaMax).toBe(20);
    expect(ruleFor("threads")?.mediaMax).toBe(10);
    expect(ruleFor("youtube")?.mediaMax).toBe(1);
    expect(ruleFor("youtube")?.mediaKind).toBe("video");
    expect(ruleFor("threads")?.mediaKind).toBe("any");
  });

  it("records the source digest, so a stale copy is detectable", () => {
    for (const rule of Object.values(PLATFORM_RULES)) {
      if (rule.platform === "youtube") {
        // No markdown to digest: the version names the API reference the numbers came from.
        expect(rule.sourcePath).toContain("developers.google.com/youtube");
      } else {
        expect(rule.sourceDigest).toMatch(/^[0-9a-f]{12}$/);
        expect(rule.sourcePath).toMatch(/^social\/[a-z]+\/specs\.md$/);
      }
      expect(specVersionFor(rule.platform)).toBe(`${rule.platform}@${rule.sourceDigest}`);
    }
  });
});

describe("counting is the platform's arithmetic, not string length", () => {
  it("counts a plain caption as its length", () => {
    expect(countFor("instagram", "hello", []).counted).toBe(5);
  });

  it("spends one budget on Threads' caption and hashtags", () => {
    const without = countFor("threads", "hello", []);
    const withTags = countFor("threads", "hello", ["one", "two"]);
    expect(withTags.counted).toBe(without.counted + 1 + "#one".length + "#two".length);
  });

  it("leaves Instagram's hashtags out of the caption count — they live in the first comment", () => {
    expect(countFor("instagram", "hello", ["one", "two"]).counted).toBe(5);
  });

  it("counts a YouTube description in UTF-8 bytes, hashtags included", () => {
    const caption = "é".repeat(100);
    const result = countFor("youtube", caption, ["one"]);

    expect(result.unit).toBe("bytes");
    // 100 characters, 200 bytes, plus the blank line and `#one` the description carries.
    expect(result.counted).toBe(utf8Bytes(youtubeDescription(caption, ["one"])));
    expect(result.counted).toBeGreaterThan(200);
  });

  it("blocks a description that fits in characters but not in bytes", () => {
    // 3000 characters, 6000 bytes: under the Help page's number, over the API's.
    const verdict = validate("youtube", {
      title: "A title",
      caption: "é".repeat(3000),
      hashtags: [],
      media: [video],
    });

    expect(verdict.count.unit).toBe("bytes");
    expect(verdict.state).toBe("blocked");
    expect(verdict.issues[0]).toMatchObject({ field: "caption", level: "blocked" });
    expect(verdict.issues[0].message).toContain("bytes");
  });

  it("normalises a hashtag once, so '#one' and 'one' cost the same", () => {
    expect(normaliseTag("one")).toBe("#one");
    expect(normaliseTag("#one")).toBe("#one");
    expect(countFor("threads", "", ["one"]).counted).toBe(countFor("threads", "", ["#one"]).counted);
  });

  it("reports what is left rather than only what is used", () => {
    expect(countFor("threads", "abc", []).remaining).toBe(497);
  });
});

describe("YouTube's metadata limits are the API's, not a round number", () => {
  it("blocks a title one character over, naming the field and its limit", () => {
    const ok = validate("youtube", { title: "t".repeat(100), caption: "ok", hashtags: [], media: [video] });
    expect(ok.state).toBe("ok");

    const over = validate("youtube", { title: "t".repeat(101), caption: "ok", hashtags: [], media: [video] });
    expect(over.state).toBe("blocked");
    expect(over.issues[0]).toMatchObject({ field: "title", level: "blocked" });
    expect(over.issues[0].message).toContain("100");
  });

  it("blocks a missing title, because videos.insert requires one", () => {
    const verdict = validate("youtube", { title: "   ", caption: "ok", hashtags: [], media: [video] });
    expect(verdict.state).toBe("blocked");
    expect(verdict.issues[0]).toMatchObject({ field: "title", level: "blocked" });
  });

  it("leaves the other platforms' titles alone", () => {
    const verdict = validate("instagram", {
      title: "t".repeat(101),
      caption: "ok",
      hashtags: ["one", "two", "three"],
      media: [],
    });
    expect(verdict.issues.some((issue) => issue.field === "title")).toBe(false);
  });

  it("measures tags as one string, commas and quoted spaced tags included", () => {
    // Two plain tags: their characters plus the comma between them.
    expect(youtubeTagsLength(youtubeTags(["#one", "two"]))).toBe(7);
    // A tag containing a space counts as if quoted: its own characters plus two quote marks.
    expect(youtubeTagsLength(youtubeTags(["a b"]))).toBe(5);

    const over = validate("youtube", {
      title: "A title",
      caption: "ok",
      hashtags: Array.from({ length: 40 }, (_, index) => `tag_${index}`.padEnd(15, "x")),
      media: [video],
    });
    expect(over.state).toBe("blocked");
    expect(over.issues.some((issue) => issue.field === "hashtags" && issue.level === "blocked")).toBe(true);
  });

  it("blocks a non-video file, because an upload is a video", () => {
    const verdict = validate("youtube", {
      title: "A title",
      caption: "ok",
      hashtags: [],
      media: [{ bytes: 10_000, width: 1080, height: 1080, mime: "image/jpeg", postable: true }],
    });
    expect(verdict.state).toBe("blocked");
    expect(verdict.issues.some((issue) => issue.field === "media")).toBe(true);
  });

  it("blocks two videos: one upload is one video", () => {
    const verdict = validate("youtube", {
      title: "A title",
      caption: "ok",
      hashtags: [],
      media: [video, { ...video, bytes: 2048 }],
    });
    expect(verdict.state).toBe("blocked");
    expect(verdict.issues.some((issue) => issue.message.includes("media items"))).toBe(true);
  });
});

describe("the verdict separates 'the platform would refuse' from 'a human should look'", () => {
  it("accepts the real Instagram caption", () => {
    const verdict = validate("instagram", { caption: REAL_IG_CAPTION, hashtags: ["a", "b", "c"], media: [] });
    expect(verdict.state).toBe("ok");
    expect(verdict.issues).toEqual([]);
  });

  it("blocks a caption over the ceiling", () => {
    const verdict = validate("threads", { caption: "a".repeat(501), hashtags: ["one"], media: [] });
    expect(verdict.state).toBe("blocked");
    expect(verdict.issues[0]).toMatchObject({ field: "caption", level: "blocked" });
  });

  it("warns, but does not block, on too many hashtags", () => {
    const verdict = validate("threads", { caption: "ok", hashtags: ["a", "b", "c", "d", "e", "f"], media: [] });
    expect(verdict.state).toBe("warn");
    expect(verdict.issues[0]).toMatchObject({ field: "hashtags", level: "warn" });
  });

  it("warns when a platform that expects hashtags gets none", () => {
    const verdict = validate("instagram", { caption: "ok", hashtags: [], media: [] });
    expect(verdict.issues.some((issue) => issue.field === "hashtags")).toBe(true);
  });

  it("blocks more media than the platform accepts", () => {
    const media = Array.from({ length: 11 }, () => ({
      bytes: 1000,
      width: 1600,
      height: 900,
      mime: "image/jpeg",
      postable: true,
    }));
    const verdict = validate("threads", { caption: "ok", hashtags: ["one"], media });
    expect(verdict.state).toBe("blocked");
    expect(verdict.issues.some((issue) => issue.message.includes("media items"))).toBe(true);
  });

  it("does not count reference-only media against the ceiling", () => {
    const media = Array.from({ length: 11 }, () => ({
      bytes: 1000,
      width: 1600,
      height: 900,
      mime: "image/jpeg",
      postable: false,
    }));
    const verdict = validate("threads", { caption: "ok", hashtags: ["one"], media });
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

  it("fails closed for x, which no longer has a rule set", () => {
    const verdict = validate("x", { caption: "hi", hashtags: [], media: [] });
    expect(verdict.state).toBe("blocked");
  });
});
