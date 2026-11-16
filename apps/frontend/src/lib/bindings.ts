/**
 * Reaching the Worker bindings from application code, on both runtimes.
 *
 * Under the Worker (and under `vinext dev`) the bindings arrive as the `cloudflare:workers` module
 * export `env`. Under plain `next dev` — which has no Worker and no D1 — that module does not
 * exist, so this returns `null` and callers degrade instead of crashing.
 *
 * Deliberately not a module-level import: a static `import ... from "cloudflare:workers"` breaks the
 * Node build, and a module-level `env` captured once is exactly the dead-binding bug that bites on
 * Workers when an isolate outlives its binding.
 */
import type { WorkerEnv } from "@/lib/env";

export async function getBindings(): Promise<WorkerEnv | null> {
  try {
    const mod = (await import(/* @vite-ignore */ "cloudflare:workers")) as { env?: WorkerEnv };
    return mod.env ?? null;
  } catch {
    return null;
  }
}
