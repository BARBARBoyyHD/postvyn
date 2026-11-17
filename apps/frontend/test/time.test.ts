/**
 * Display-only time helpers.
 *
 * The only branch worth a test is the duration: `attempt 2 · 1.4s` is the phrase the history promises,
 * and a malformed zone must degrade to UTC rather than take a page down.
 */
import { describe, expect, it } from "vitest";

import { formatAttemptDuration, formatInZone, slotInputValue } from "@/lib/time";

describe("attempt duration", () => {
  it("is null before the first attempt, running during one, and short seconds after it", () => {
    expect(formatAttemptDuration(null, null)).toBeNull();
    expect(formatAttemptDuration(1_000, null)).toBe("running");
    expect(formatAttemptDuration(1_000, 2_400)).toBe("1.4s");
    expect(formatAttemptDuration(0, 90_000)).toBe("2m");
  });
});

describe("workspace timezone display", () => {
  it("renders the same instant in the zone it was asked for", () => {
    expect(formatInZone(0, "UTC")).toContain("01 Jan");
    expect(formatInZone(0, "UTC")).toContain("00:00");
    expect(formatInZone(0, "Asia/Jakarta")).toContain("07:00");
  });

  it("falls back to UTC for a zone the runtime cannot parse", () => {
    expect(formatInZone(0, "Not/AZone")).toBe("1970-01-01 00:00 UTC");
  });
});

describe("slot input", () => {
  it("formats a value the datetime-local input accepts", () => {
    expect(slotInputValue(Date.UTC(2026, 10, 17, 9, 0))).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});
