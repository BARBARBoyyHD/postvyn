/**
 * The job queue.
 *
 * A Worker cannot outlive a request, so the work is a row and the tick is a cron: claim one job, do one
 * step, write what happened. Three guarantees matter and each has its own test:
 *
 *  - **one claim, one publish** — the claim is a single `UPDATE … RETURNING` guarded by state; D1's single
 *    writer serialises it, so two ticks cannot both win (ADR-015). Zero rows is the normal losing case.
 *  - **a stuck job is reclaimable** — the lease expires and a later tick takes it, with the attempt count
 *    rising so a poison job cannot spin forever.
 *  - **ambiguity is not retried** — a call whose response was lost goes to `uncertain`, never back to the
 *    queue. A duplicate post is worse than a manual check.
 */
import { and, eq, lte, sql } from "drizzle-orm";

import { createDb, type Bindings } from "@/db/client";
import * as s from "@/db/schema";

/** How long a claim is valid before another tick may take the job. */
export const LEASE_MS = 60_000;
export const MAX_ATTEMPTS = 3;

export type JobState = "queued" | "claimed" | "awaiting_platform" | "done" | "failed" | "dead";

export function jobs(env: Bindings) {
  const db = createDb(env.DB);

  return {
    /** Enqueue at most once per (kind, variant): a double click must not create a second publish. */
    async enqueue(input: {
      kind: string;
      variantId: string;
      runAfter: number;
      payload?: Record<string, unknown>;
    }) {
      const payload = JSON.stringify({ variantId: input.variantId, ...(input.payload ?? {}) });
      const now = Date.now();

      const [existing] = await db
        .select({ id: s.jobs.id })
        .from(s.jobs)
        .where(
          and(
            eq(s.jobs.kind, input.kind),
            sql`json_extract(${s.jobs.payload}, '$.variantId') = ${input.variantId}`,
            sql`${s.jobs.state} in ('queued', 'claimed', 'awaiting_platform')`,
          ),
        )
        .limit(1);
      if (existing) return { id: existing.id, created: false as const };

      const id = `job_${crypto.randomUUID().slice(0, 10)}`;
      await db.insert(s.jobs).values({
        id,
        kind: input.kind,
        payload,
        state: "queued",
        attempts: 0,
        runAfter: input.runAfter,
        createdAt: now,
        updatedAt: now,
      });
      return { id, created: true as const };
    },

    /**
     * Claim one due job whose workspace has publishing enabled.
     *
     * The kill switch is checked **here**, not at enqueue: an enqueue-time check leaves a window where
     * queued work still fires after somebody hits stop.
     */
    async claim(now = Date.now(), globalEnabled = true) {
      if (!globalEnabled) return null;

      const claimed = await db
        .update(s.jobs)
        .set({
          state: "claimed",
          leaseUntil: now + LEASE_MS,
          attempts: sql`${s.jobs.attempts} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(s.jobs.state, "queued"),
            lte(s.jobs.runAfter, now),
            sql`${s.jobs.id} = (
              select j.id from jobs j
              join variants v on v.id = json_extract(j.payload, '$.variantId')
              join posts p on p.id = v.post_id
              join workspaces w on w.id = p.workspace_id
              where j.state = 'queued' and j.run_after <= ${now} and w.publishing_enabled = 1
              order by j.run_after asc
              limit 1
            )`,
          ),
        )
        .returning();

      return claimed[0] ?? null;
    },

    /** Reclaim a job whose lease expired without completing. The attempt count already rose at claim. */
    async reclaimExpired(now = Date.now()) {
      const result = await db
        .update(s.jobs)
        .set({ state: "queued", leaseUntil: null, updatedAt: now })
        .where(and(eq(s.jobs.state, "claimed"), lte(s.jobs.leaseUntil, now)))
        .returning({ id: s.jobs.id, attempts: s.jobs.attempts });

      // Anything that has run out of attempts is dead rather than queued again.
      const dead: string[] = [];
      for (const row of result) {
        if (row.attempts >= MAX_ATTEMPTS) {
          await db
            .update(s.jobs)
            .set({ state: "dead", lastError: "lease expired after the last attempt", updatedAt: now })
            .where(eq(s.jobs.id, row.id));
          dead.push(row.id);
        }
      }
      return { requeued: result.filter((row) => !dead.includes(row.id)).map((row) => row.id), dead };
    },

    /** Terminal, non-retryable: the reason is a human problem (content changed) or a policy refusal. */
    async dead(id: string, reason: string) {
      await db
        .update(s.jobs)
        .set({ state: "dead", leaseUntil: null, lastError: reason, updatedAt: Date.now() })
        .where(eq(s.jobs.id, id));
    },

    async complete(id: string, detail?: unknown) {
      await db
        .update(s.jobs)
        .set({ state: "done", leaseUntil: null, lastError: null, updatedAt: Date.now() })
        .where(eq(s.jobs.id, id));
      void detail;
    },

    /** Park until the platform finishes. Not a retry: the attempt that parked it keeps its count. */
    async park(id: string, reason: string, resumeAfterMs: number) {
      const now = Date.now();
      await db
        .update(s.jobs)
        .set({
          state: "awaiting_platform",
          leaseUntil: null,
          lastError: reason,
          runAfter: now + resumeAfterMs,
          updatedAt: now,
        })
        .where(eq(s.jobs.id, id));
    },

    /**
     * A failure either retries with backoff or stops. `ambiguous` skips the retry entirely.
     */
    async fail(id: string, message: string, options: { ambiguous?: boolean } = {}) {
      const now = Date.now();
      const [row] = await db.select().from(s.jobs).where(eq(s.jobs.id, id)).limit(1);
      if (!row) return { state: "missing" as const };

      if (options.ambiguous) {
        await db
          .update(s.jobs)
          .set({ state: "failed", leaseUntil: null, lastError: `uncertain: ${message}`, updatedAt: now })
          .where(eq(s.jobs.id, id));
        return { state: "failed" as const, retryIn: null };
      }

      if (row.attempts >= MAX_ATTEMPTS) {
        await db
          .update(s.jobs)
          .set({ state: "dead", leaseUntil: null, lastError: message, updatedAt: now })
          .where(eq(s.jobs.id, id));
        return { state: "dead" as const, retryIn: null };
      }

      // 1 min, 4 min, 9 min — quadratic, because a failing platform gets worse before it gets better.
      const delay = row.attempts * row.attempts * 60_000;
      await db
        .update(s.jobs)
        .set({ state: "queued", leaseUntil: null, lastError: message, runAfter: now + delay, updatedAt: now })
        .where(eq(s.jobs.id, id));
      return { state: "queued" as const, retryIn: delay };
    },

    /** What is due in the next window, for the operator's "what ships tomorrow" question. */
    async dueBetween(from: number, to: number) {
      return db
        .select()
        .from(s.jobs)
        .where(
          and(
            sql`${s.jobs.state} in ('queued', 'awaiting_platform')`,
            sql`${s.jobs.runAfter} >= ${from} and ${s.jobs.runAfter} <= ${to}`,
          ),
        )
        .orderBy(s.jobs.runAfter);
    },

    async get(id: string) {
      const [row] = await db.select().from(s.jobs).where(eq(s.jobs.id, id)).limit(1);
      return row ?? null;
    },
  };
}
