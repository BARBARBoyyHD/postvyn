/**
 * What the cron does: one tick of the queue, then the credential maintenance that must not be
 * forgotten. Both are cheap when there is nothing to do, and both are idempotent, so a missed tick or
 * a doubled one changes nothing (docs/003-ITA.md §6: "a missed tick is harmless").
 *
 * Called by the Worker's `scheduled` export and by `POST /api/internal/tick`, so "it worked when I ran
 * it" and "it worked at 09:05" are the same code path (m4 design decision 7). It runs for every
 * workspace, which is why it takes no `WorkspaceContext`: it chooses no tenant, it walks them.
 */
import { runTick, type TickReport } from "./tick";
import { refreshTokens, type TokenRefreshReport } from "./token-refresh";
import type { Publisher } from "@/publishers/port";
import { liveTransport, type Transport } from "@/publishers/transport";
import type { WorkerEnv } from "@/lib/env";

/**
 * The hygiene schedule. The Worker tells the two crons apart by this string, which Cloudflare hands
 * back as `controller.cron`, so `wrangler.jsonc`'s `triggers.crons` must list it verbatim.
 *
 * Daily, not every five minutes: the retention window is measured in days, and a sweep that runs 288
 * times a day to find nothing is a cost with no product behind it (design.md decision 5).
 */
export const HYGIENE_CRON = "0 3 * * *";

export interface ScheduledReport {
  tick: TickReport;
  tokens: TokenRefreshReport;
}

export interface ScheduledOptions {
  /** Test seams. Production passes neither: the adapters and the network are the real ones. */
  publisher?: Publisher;
  transport?: Transport;
  now?: number;
}

export async function runScheduled(
  env: WorkerEnv,
  options: ScheduledOptions = {},
): Promise<ScheduledReport> {
  const now = options.now ?? Date.now();

  return {
    tick: await runTick(env, {
      publisher: options.publisher,
      now,
      globalEnabled: env.PUBLISHING_ENABLED === "true",
    }),
    tokens: await refreshTokens(env, {
      transport: options.transport ?? liveTransport(),
      now,
    }),
  };
}
