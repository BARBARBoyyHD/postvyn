/**
 * Which adapter answers for which platform.
 *
 * One place, because the board's upload button and the cron tick must never disagree about who
 * publishes. The lookup is per platform — a variant belongs to exactly one channel — so callers
 * resolve after they know the channel, which is inside `src/db/tick.ts` where the row is loaded.
 */
import type { Platform } from "@/lib/specs/platforms";

import { instagramPublisher } from "./instagram";
import { notConnectedPublisher, type Publisher } from "./port";
import { threadsPublisher } from "./threads";
import { tiktokRefusal } from "./tiktok";
import { liveTransport } from "./transport";

export function publisherFor(platform: Platform): Publisher {
  switch (platform) {
    case "instagram":
      return instagramPublisher({ transport: liveTransport() });
    case "threads":
      return threadsPublisher({ transport: liveTransport() });
    case "tiktok":
      return tiktokRefusal();
    case "x":
      // §5 of this change. The stand-in is honest until OAuth 1.0a signing and cost disclosure land.
      return notConnectedPublisher();
    default: {
      const never: never = platform;
      throw new Error(`no publisher for platform ${String(never)}`);
    }
  }
}
