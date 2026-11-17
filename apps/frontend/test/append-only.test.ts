/**
 * The append-only guarantees, tested as rules rather than trusted as conventions.
 *
 * Two tables say "this is a record, not a row you edit": `activity_log` (migration 0012) and
 * `variant_overrides` (0015). Both are enforced by triggers, and a trigger is invisible until somebody
 * tries. This file tries.
 *
 * Why it matters: an approval history that can be edited is not evidence, and an override that can be
 * deleted is not an override. The cascade case is the one that bites — deleting a workspace cascades
 * into `activity_log`, and the rule must refuse that too.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

const WS = "ws-append";

async function seed() {
  await env.DB.prepare(
    "insert or ignore into workspaces (id, name, plan, timezone, publishing_enabled, created_at, updated_at) values (?, 'Append', 'free', 'UTC', 0, ?, ?)",
  )
    .bind(WS, Date.now(), Date.now())
    .run();

  await env.DB.prepare(
    "insert or ignore into activity_log (id, workspace_id, post_id, actor_id, action, detail, created_at) values ('act_append_1', ?, null, null, 'test.seed', '{}', ?)",
  )
    .bind(WS, Date.now())
    .run();
}

describe("activity_log", () => {
  beforeEach(seed);

  it("refuses an update", async () => {
    await expect(
      env.DB.prepare("update activity_log set action = 'tampered' where id = 'act_append_1'").run(),
    ).rejects.toThrow(/append-only/i);
  });

  it("refuses a delete", async () => {
    await expect(
      env.DB.prepare("delete from activity_log where id = 'act_append_1'").run(),
    ).rejects.toThrow(/append-only/i);
  });

  it("refuses the cascade from deleting its workspace", async () => {
    await expect(env.DB.prepare("delete from workspaces where id = ?").bind(WS).run()).rejects.toThrow(
      /append-only/i,
    );
  });

  it("still accepts an insert", async () => {
    const id = `act_append_${Date.now()}`;
    await env.DB.prepare(
      "insert into activity_log (id, workspace_id, post_id, actor_id, action, detail, created_at) values (?, ?, null, null, 'test.append', '{}', ?)",
    )
      .bind(id, WS, Date.now())
      .run();

    const row = await env.DB.prepare("select id from activity_log where id = ?").bind(id).first<{ id: string }>();
    expect(row?.id).toBe(id);
  });
});

describe("variant_overrides", () => {
  const VARIANT = "var_append";
  const POST = "post_append";
  const BRAND = "brand_append";
  const CHANNEL = "chn_append";

  beforeEach(async () => {
    await seed();
    const now = Date.now();
    await env.DB.prepare(
      "insert or ignore into brands (id, workspace_id, slug, name, created_at, updated_at) values (?, ?, 'append', 'Append', ?, ?)",
    )
      .bind(BRAND, WS, now, now)
      .run();
    await env.DB.prepare(
      "insert or ignore into channels (id, brand_id, platform, account_ref, status, created_at, updated_at) values (?, ?, 'threads', 'append', 'active', ?, ?)",
    )
      .bind(CHANNEL, BRAND, now, now)
      .run();
    await env.DB.prepare(
      "insert or ignore into posts (id, workspace_id, brand_id, title, format, status, created_at, updated_at) values (?, ?, ?, 'Append', 'text', 'review', ?, ?)",
    )
      .bind(POST, WS, BRAND, now, now)
      .run();
    await env.DB.prepare(
      "insert or ignore into variants (id, post_id, channel_id, caption, hashtags, media_ids, spec_state, created_at, updated_at) values (?, ?, ?, 'cap', '[]', '[]', 'warn', ?, ?)",
    )
      .bind(VARIANT, POST, CHANNEL, now, now)
      .run();
    await env.DB.prepare(
      "insert or ignore into variant_overrides (id, variant_id, workspace_id, issue_field, issue_key, reason, actor_id, created_at) values ('ovr_append', ?, ?, 'hashtags', 'too many', 'brand allows 4', null, ?)",
    )
      .bind(VARIANT, WS, now)
      .run();
  });

  it("refuses an update", async () => {
    await expect(
      env.DB.prepare("update variant_overrides set reason = 'because' where id = 'ovr_append'").run(),
    ).rejects.toThrow(/append-only/i);
  });

  it("refuses a delete", async () => {
    await expect(
      env.DB.prepare("delete from variant_overrides where id = 'ovr_append'").run(),
    ).rejects.toThrow(/append-only/i);
  });

  it("keeps the reason it was given", async () => {
    const row = await env.DB.prepare("select reason from variant_overrides where id = 'ovr_append'").first<{
      reason: string;
    }>();
    expect(row?.reason).toBe("brand allows 4");
  });
});
