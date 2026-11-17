/**
 * The scheduled entry's work (`runScheduled`), and the no-op it must be when nothing is due.
 *
 * The handler itself is six lines in `src/worker.ts` and cannot be imported here — it pulls vinext's
 * virtual worker entry, which only exists inside a Vite build. So the behaviour is tested where it
 * lives, and the entry's only job is to call it: the same function `POST /api/internal/tick` calls.
 *
 * "Nothing noisy" is asserted the way m4 asserts it: the report is empty, the row is byte-identical,
 * the publisher is never called, and not one line is logged.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jobs } from "@/db/jobs";
import { runScheduled } from "@/db/scheduled";
import type { Publisher } from "@/publishers/port";
import type { WorkerEnv } from "@/lib/env";
import { fixtureTransport } from "./support/fixture-transport";

const testEnv: WorkerEnv = { DB: env.DB, TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" };

const WS = "ws-cron";
const BRAND = "brand-cron";

function stubPublisher(): { publisher: Publisher; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    publisher: {
      platform: "x",
      async preview() {
        return { calls: [], estimatedCostUsd: null, notes: [] };
      },
      async publish() {
        calls += 1;
        return { status: "published", platformPostId: "x", permalink: null };
      },
      async verify(result) {
        return result;
      },
    },
  };
}

async function seed() {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("delete from jobs"),
    env.DB.prepare(
      "insert or ignore into workspaces (id, name, plan, timezone, publishing_enabled, created_at, updated_at) values (?, 'Cron', 'free', 'UTC', 1, ?, ?)",
    ).bind(WS, now, now),
    env.DB.prepare(
      "insert or ignore into brands (id, workspace_id, slug, name, created_at, updated_at) values (?, ?, 'cron', 'Cron', ?, ?)",
    ).bind(BRAND, WS, now, now),
  ]);
}

describe("the scheduled tick", () => {
  beforeEach(seed);

  it("does nothing at all when no job is due", async () => {
    // Queued for tomorrow: visible to the operator, not due to the tick.
    const enqueued = await jobs(testEnv).enqueue({
      kind: "publish_variant",
      variantId: "var-cron",
      runAfter: Date.now() + 3_600_000,
    });

    const before = await jobs(testEnv).get(enqueued.id);
    const stub = stubPublisher();
    const transport = fixtureTransport({ replies: [] });

    const noise = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")].map(
      (spy) => spy.mockImplementation(() => undefined),
    );
    console.log("probe");
    expect(noise[0].mock.calls).toHaveLength(1);
    for (const spy of noise) spy.mockClear();

    const report = await runScheduled(testEnv, { publisher: stub.publisher, transport: transport.transport });

    expect(report.tick).toEqual({ reclaimed: [], dead: [], claimed: 0, outcomes: [] });
    expect(report.tokens).toEqual({ checked: 0, refreshed: [], failed: [] });
    expect(stub.calls()).toBe(0);
    expect(transport.calls).toEqual([]);
    expect(noise.flatMap((spy) => spy.mock.calls)).toEqual([]);
    expect(await jobs(testEnv).get(enqueued.id)).toEqual(before);

    for (const spy of noise) spy.mockRestore();
  });
});
