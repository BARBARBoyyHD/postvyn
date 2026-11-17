/**
 * Cost wording, because the number is a promise made before money is spent.
 *
 * The branch that matters is `null`: it means "free" for Meta's platforms and "not posted here"
 * for TikTok, and the UI must not print a fake `$0.00` for either.
 */
import { describe, expect, it } from "vitest";

import { costLabel, usd } from "@/lib/cost";

describe("cost labels", () => {
  it("keeps X's three-decimal price and its link price", () => {
    expect(costLabel("x", 0.015)).toBe("$0.015");
    expect(costLabel("x", 0.2)).toBe("$0.20");
  });

  it("calls Meta's null estimate free, and TikTok's null estimate nothing", () => {
    expect(costLabel("instagram", null)).toBe("free");
    expect(costLabel("threads", null)).toBe("free");
    expect(costLabel("tiktok", null)).toBeNull();
  });

  it("never turns a zero or missing estimate into a dollar figure", () => {
    expect(costLabel("x", 0)).toBeNull();
    expect(costLabel("x", undefined)).toBeNull();
  });

  it("formats a plain amount with cents for a stored result", () => {
    expect(usd(0.015)).toBe("$0.015");
    expect(usd(1)).toBe("$1.00");
  });
});
