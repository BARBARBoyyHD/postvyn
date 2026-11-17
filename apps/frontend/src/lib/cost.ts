/**
 * How a publish estimate is worded.
 *
 * `null` is not zero: Instagram and Threads charge nothing per post, while TikTok answers `null`
 * for a different reason — nothing here will ever post it. Printing "$0.00" for either would claim
 * a fact the preview did not give, so a free label is only used for the platforms whose preview
 * means "free". YouTube is neither: it meters quota, not money, and its preview says so in `notes`
 * (platform-swap-youtube decision 5). The column stays generic because past X results still carry a
 * stored estimate and this file is what renders them.
 */
const FREE_PLATFORMS = new Set(["instagram", "threads"]);

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});

export function usd(amount: number): string {
  return USD.format(amount);
}

/** The cost to show the operator, or null when there is no honest number to show. */
export function costLabel(
  platform: string,
  estimatedCostUsd: number | null | undefined,
): string | null {
  if (typeof estimatedCostUsd === "number") {
    return estimatedCostUsd > 0 ? usd(estimatedCostUsd) : null;
  }
  return FREE_PLATFORMS.has(platform) ? "free" : null;
}
