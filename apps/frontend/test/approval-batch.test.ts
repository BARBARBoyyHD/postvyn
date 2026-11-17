/**
 * Bulk approval: one item's failure is an answer, not an exception.
 *
 * The properties proven here are the ones the spec names — a per-item outcome, one audit row per
 * success, and no rollback of the approvals beside a bad item. The batch runs against the domain
 * (`approvals.approveBatch`), which is where the loop and the gate live; the route above it only
 * parses and shapes.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { approvals } from "@/db/approvals";
import { hashParts } from "@/lib/approval";
import { parseSlotAt } from "@/lib/approval-request";
import type { WorkerEnv } from "@/lib/env";

const testEnv = env as unknown as WorkerEnv;

const WS = "ws-batch";
const OTHER_WS = "ws-batch-other";
const USER = "user-batch";

const ctx = { workspaceId: WS, userId: USER, role: "owner" as const };

/** Four variants, each with its own post and channel: one per outcome the batch has to name. */
const OK = "var-batch-ok";
const STALE = "var-batch-stale";
const BLOCKED = "var-batch-blocked";
const FOREIGN = "var-batch-foreign";

const BLOCKED_CAPTION = "x".repeat(600); // threads accepts 500 including hashtags: a hard error

async function seedVariant(workspaceId: string, variantId: string, caption: string) {
  const now = Date.now();
  const brandId = `brand-${variantId}`;
  const channelId = `chn-${variantId}`;
  const postId = `post-${variantId}`;

  await env.DB.batch([
    env.DB.prepare("insert or ignore into brands (id, workspace_id, slug, name) values (?, ?, ?, ?)").bind(
      brandId,
      workspaceId,
      variantId,
      variantId,
    ),
    env.DB.prepare(
      "insert or ignore into channels (id, brand_id, platform, account_ref, status) values (?, ?, 'threads', ?, 'active')",
    ).bind(channelId, brandId, variantId),
    env.DB.prepare(
      "insert or ignore into posts (id, workspace_id, brand_id, title, format, status, created_at, updated_at) values (?, ?, ?, 'Batch', 'text', 'review', ?, ?)",
    ).bind(postId, workspaceId, brandId, now, now),
    env.DB.prepare(
      "insert or ignore into variants (id, post_id, channel_id, caption, hashtags, media_ids, spec_state, created_at, updated_at) values (?, ?, ?, ?, '[\"#one\"]', '[]', 'ok', ?, ?)",
    ).bind(variantId, postId, channelId, caption, now, now),
  ]);
}

async function seed() {
  const now = Date.now();
  await env.DB.prepare(
    "insert or ignore into workspaces (id, name, plan, timezone, publishing_enabled, created_at, updated_at) values (?, 'Batch', 'free', 'UTC', 1, ?, ?)",
  )
    .bind(WS, now, now)
    .run();
  await env.DB.prepare(
    "insert or ignore into workspaces (id, name, plan, timezone, publishing_enabled, created_at, updated_at) values (?, 'Other', 'free', 'UTC', 1, ?, ?)",
  )
    .bind(OTHER_WS, now, now)
    .run();

  await seedVariant(WS, OK, "the caption");
  await seedVariant(WS, STALE, "the caption");
  await seedVariant(WS, BLOCKED, BLOCKED_CAPTION);
  await seedVariant(OTHER_WS, FOREIGN, "another tenant's caption");

  // Nothing here is append-only; a row left by an earlier case would change the counts below.
  await env.DB.batch([
    env.DB.prepare("delete from jobs"),
    env.DB.prepare("delete from approvals"),
    env.DB.prepare("delete from publish_results"),
  ]);
}

const auditRows = async (variantId: string) => {
  const row = await env.DB.prepare(
    "select count(*) as n from activity_log where action = 'variant.approved' and json_extract(detail, '$.variantId') = ?",
  )
    .bind(variantId)
    .first<{ n: number }>();
  return Number(row?.n);
};

describe("bulk approve", () => {
  beforeEach(seed);

  it("names each item's outcome and audits only the successes", async () => {
    const slot = Date.now() + 3_600_000;
    const wrongHash = await hashParts("what the operator saw", [], []);

    const report = await approvals(testEnv).approveBatch(
      ctx,
      [
        { id: OK },
        { id: STALE, hash: wrongHash },
        { id: BLOCKED },
        { id: FOREIGN },
      ],
      { slotAt: slot, note: "clear the queue" },
    );

    expect(report.slotAt).toBe(slot);
    expect(report.approved).toBe(1);
    expect(report.failed).toBe(3);

    const byId = new Map(report.items.map((item) => [item.id, item]));

    expect(byId.get(OK)?.ok).toBe(true);

    expect(byId.get(STALE)).toMatchObject({
      ok: false,
      error: "reapproval_required",
      expected: wrongHash,
      current: expect.any(String) as string,
    });

    const blockedItem = byId.get(BLOCKED);
    expect(blockedItem?.ok).toBe(false);
    if (blockedItem && !blockedItem.ok && blockedItem.error === "spec_blocked") {
      expect(blockedItem.violations[0]?.field).toBe("caption");
      expect(blockedItem.violations[0]?.message).toContain("500");
    } else {
      throw new Error(`expected spec_blocked, got ${JSON.stringify(blockedItem)}`);
    }

    expect(byId.get(FOREIGN)).toEqual({ id: FOREIGN, ok: false, error: "not_found" });

    // one audit row per success, none for the failures — the spec's "twelve approvals, twelve traces"
    expect(await auditRows(OK)).toBe(1);
    expect(await auditRows(STALE)).toBe(0);
    expect(await auditRows(BLOCKED)).toBe(0);
    expect(await auditRows(FOREIGN)).toBe(0);

    // and the writes that did happen belong to the one item that succeeded
    const approved = await env.DB.prepare("select variant_id from approvals").all<{ variant_id: string }>();
    expect(approved.results.map((row) => row.variant_id)).toEqual([OK]);

    const queued = await env.DB.prepare(
      "select json_extract(payload, '$.variantId') as variantId from jobs",
    ).all<{ variantId: string }>();
    expect(queued.results.map((row) => row.variantId)).toEqual([OK]);

    // a foreign variant is untouched, not merely refused
    const foreignPost = await env.DB.prepare("select status from posts where id = ?")
      .bind(`post-${FOREIGN}`)
      .first<{ status: string }>();
    expect(foreignPost?.status).toBe("review");
  });
});

describe("the approval slot", () => {
  it("accepts a future time in either form and refuses a past or nonsense one", () => {
    const future = Date.now() + 60_000;
    expect(parseSlotAt(future)).toBe(future);
    expect(parseSlotAt(new Date(future).toISOString())).toBe(future);
    expect(parseSlotAt(Date.now() - 1_000)).toBeNull();
    expect(parseSlotAt("not a date")).toBeNull();
  });
});
