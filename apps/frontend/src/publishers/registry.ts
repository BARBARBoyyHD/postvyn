/**
 * Which adapter answers for which platform.
 *
 * One place, because the board's upload button and the cron tick must never disagree about who
 * publishes. The lookup is per platform — a variant belongs to exactly one channel — so callers
 * resolve after they know the channel, which is inside `src/db/tick.ts` where the row is loaded.
 *
 * The switch is exhaustive over `Platform`: a platform the app cannot publish to fails here rather
 * than in a cron log at 03:00. `x` is deliberately absent — it left the lineup on 2026-11-17, and while
 * historical rows still read (the DB's CHECK keeps them), nothing may resolve an adapter for one.
 */
import type { Platform } from "@/lib/specs/platforms";

import { instagramPublisher } from "./instagram";
import { type Publisher } from "./port";
import { threadsPublisher } from "./threads";
import { tiktokRefusal } from "./tiktok";
import { liveTransport } from "./transport";
import { youtubePublisher } from "./youtube";

export function publisherFor(platform: Platform): Publisher {
  switch (platform) {
    case "instagram":
      return instagramPublisher({ transport: liveTransport() });
    case "threads":
      return threadsPublisher({ transport: liveTransport() });
    case "youtube":
      return youtubePublisher({ transport: liveTransport() });
    case "tiktok":
      return tiktokRefusal();
    default: {
      const never: never = platform;
      throw new Error(`no publisher for platform ${String(never)}`);
    }
  }
}
