/**
 * The Worker entry: vinext answers requests, and the cron has somewhere to run.
 *
 * Why this file exists at all: `triggers.crons` without a `scheduled` export fails on every
 * invocation, which is worse than no trigger (M0 shipped neither, deliberately). M4 found the trigger
 * was not needed while the upload button was the only path; M5 needs polling to continue after the
 * request that created a container has ended. The export and `wrangler.jsonc`'s `triggers` are one
 * thing and are never separated again (m4 design decisions 4 and 7).
 *
 * The scheduled path authenticates nothing and trusts nothing outside its own bindings: Cloudflare
 * invokes it, not a caller, so it cannot be reached from outside and needs no secret. `CRON_SECRET`
 * exists for the HTTP door to the same work (`POST /api/internal/tick`), which *can* be reached.
 */
import vinext from "vinext/server/fetch-handler";

import { runScheduled } from "./db/scheduled";
import type { WorkerEnv } from "./lib/env";

export default {
  fetch: vinext.fetch,

  async scheduled(_controller: ScheduledController, env: WorkerEnv): Promise<void> {
    await runScheduled(env);
  },
} satisfies ExportedHandler<WorkerEnv>;
