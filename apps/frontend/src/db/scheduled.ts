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
import { refreshInstagramTokens, type TokenRefreshReport } from "./token-refresh";
import type { Publisher } from "@/publishers/port";
import { liveTransport, type Transport } from "@/publishers/transport";
import type { WorkerEnv } from "@/lib/env";

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
    tokens: await refreshInstagramTokens(env, {
      transport: options.transport ?? liveTransport(),
      now,
    }),
  };
}
