/**
 * Which adapter answers for which platform.
 *
 * One place, because the board's upload button and the cron tick must never disagree about who
 * publishes. The lookup is per platform — a variant belongs to exactly one channel — so callers
 * resolve after they know the channel, which is inside `src/db/tick.ts` where the row is loaded.
 */
import type { Platform } from "@/lib/specs/platforms";

import { instagramPublisher } from "./instagram";
import { type Publisher } from "./port";import { threadsPublisher } from "./threads";
import { tiktokRefusal } from "./tiktok";
import { liveTransport } from "./transport";
import { xPublisher } from "./x";

/**
 * What the caller knows that an adapter cannot: whether a metered platform has been funded.
 *
 * Default false. X is the only platform that charges, and refusing to spend unconfigured money is
 * the safe answer when nobody said otherwise (design.md decision 5).
 */
export interface PublisherOptions {
  creditsConfigured?: boolean;
}

export function publisherFor(platform: Platform, options: PublisherOptions = {}): Publisher {
  switch (platform) {
    case "instagram":
      return instagramPublisher({ transport: liveTransport() });
    case "threads":
      return threadsPublisher({ transport: liveTransport() });
    case "tiktok":
      return tiktokRefusal();
    case "x":
      return xPublisher({
        transport: liveTransport(),
        creditsConfigured: options.creditsConfigured ?? false,
      });
    default: {
      const never: never = platform;
      throw new Error(`no publisher for platform ${String(never)}`);
    }
  }
}
