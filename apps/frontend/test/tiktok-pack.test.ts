/**
 * TikTok ships as a pack, and a human says when it is done (spec: manual-tiktok).
 *
 * Three properties, each a promise the product makes:
 *
 *  1. the pack is everything needed to post by hand — caption, hashtags, the assets in order, the
 *     checklist, and the one line that says why this is manual;
 *  2. nothing is `published` until the operator records the URL, and the record goes through the same
 *     `one_publish_per_variant` index as every other publish;
 *  3. the reason travels with the target, so the board, the review queue and the post detail all get
 *     it without asking a second question.
 *
 * No network is reachable from this file: there is no adapter involved, which is the point.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { approvals } from "@/db/approvals";
import { repository } from "@/db/repository";
import { tiktokStore } from "@/db/tiktok-pack";
import { TIKTOK_REASON } from "@/publishers/tiktok";
import type { WorkspaceContext } from "@/lib/context";
import type { WorkerEnv } from "@/lib/env";

const baseEnv: WorkerEnv = {
  DB: env.DB,
  TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
};
const withPublicMedia: WorkerEnv = { ...baseEnv, R2_PUBLIC_BASE: "https://media.test/" };

const WS = "ws-m5-tiktok";
const BRAND = "brand-m5-tiktok";
const OTHER_WS = "ws-m5-tiktok-other";
const OTHER_BRAND = "brand-m5-tiktok-other";

const CH_TIKTOK = "chn-m5-tt";
const CH_THREADS = "chn-m5-th";

const POST = "post-m5-tt";
const VAR_TIKTOK = "var-m5-tt";
const VAR_THREADS = "var-m5-th";

const OTHER_POST = "post-m5-tt-other";
const OTHER_VARIANT = "var-m5-tt-other";

const R2_VIDEO = "med-m5-video";
const VAULT_VIDEO = "med-m5-vault-video";

const ctx: WorkspaceContext = { workspaceId: WS, userId: "user-m5-tt", role: "owner" };
const otherCtx: WorkspaceContext = { workspaceId: OTHER_WS, userId: "user-other", role: "owner" };

const CAPTION = "the hook is on the video, this is the caption";
const HASHTAGS = ["#one", "#two", "#three"];

async function seed() {
  const now = Date.now();

  await env.DB.batch([
    env.DB.prepare("delete from publish_results"),
    env.DB.prepare("delete from jobs"),
    env.DB.prepare("delete from approvals"),
    env.DB.prepare("delete from variants"),
    env.DB.prepare("delete from media"),
    env.DB.prepare("delete from posts"),
    env.DB.prepare("delete from channels"),
  ]);

  await env.DB.batch([
    env.DB.prepare(
      "insert or ignore into workspaces (id, name, plan, timezone, publishing_enabled, created_at, updated_at) values (?, 'M5 tiktok', 'free', 'UTC', 1, ?, ?)",
    ).bind(WS, now, now),
    env.DB.prepare(
      "insert or ignore into workspaces (id, name, plan, timezone, publishing_enabled, created_at, updated_at) values (?, 'M5 tiktok other', 'free', 'UTC', 1, ?, ?)",
    ).bind(OTHER_WS, now, now),
    env.DB.prepare(
      "insert or ignore into brands (id, workspace_id, slug, name, created_at, updated_at) values (?, ?, 'm5-tiktok', 'TikTok brand', ?, ?)",
    ).bind(BRAND, WS, now, now),
    env.DB.prepare(
      "insert or ignore into brands (id, workspace_id, slug, name, created_at, updated_at) values (?, ?, 'm5-tiktok-other', 'Other', ?, ?)",
    ).bind(OTHER_BRAND, OTHER_WS, now, now),
  ]);

  await env.DB.batch([
    env.DB.prepare(
      "insert into channels (id, brand_id, platform, account_ref, label, status, created_at, updated_at) values (?, ?, 'tiktok', 'tt-1', 'the tiktok', 'active', ?, ?)",
    ).bind(CH_TIKTOK, BRAND, now, now),
    env.DB.prepare(
      "insert into channels (id, brand_id, platform, account_ref, label, status, created_at, updated_at) values (?, ?, 'threads', 'th-1', 'the threads', 'active', ?, ?)",
    ).bind(CH_THREADS, BRAND, now, now),
    env.DB.prepare(
      "insert into posts (id, workspace_id, brand_id, title, format, status, created_at, updated_at) values (?, ?, ?, 'A vertical video', 'video', 'review', ?, ?)",
    ).bind(POST, WS, BRAND, now, now),
    env.DB.prepare(
      "insert into posts (id, workspace_id, brand_id, title, format, status, created_at, updated_at) values (?, ?, ?, 'Someone else post', 'video', 'review', ?, ?)",
    ).bind(OTHER_POST, OTHER_WS, OTHER_BRAND, now, now),
  ]);

  await env.DB.batch([
    env.DB.prepare(
      "insert into media (id, workspace_id, hash, key, mime, bytes, width, height, postable) values (?, ?, 'hash-video', ?, 'video/mp4', 1048576, 1080, 1920, 1)",
    ).bind(R2_VIDEO, WS, `media/${WS}/clip.mp4`),
    // An imported row: still a vault path, so no public URL can be built for it (M6 migrates these).
    env.DB.prepare(
      "insert into media (id, workspace_id, hash, key, mime, bytes, width, height, postable) values (?, ?, 'hash-vault', 'brands/tiktok/queue/item/clip-2.mp4', 'video/mp4', 2097152, 1080, 1920, 1)",
    ).bind(VAULT_VIDEO, WS),
  ]);

  await env.DB.batch([
    env.DB.prepare(
      "insert into variants (id, post_id, channel_id, caption, hashtags, media_ids, spec_state, revision, created_at, updated_at) values (?, ?, ?, ?, ?, ?, 'ok', 0, ?, ?)",
    ).bind(VAR_TIKTOK, POST, CH_TIKTOK, CAPTION, JSON.stringify(HASHTAGS), JSON.stringify([R2_VIDEO, VAULT_VIDEO]), now, now),
    env.DB.prepare(
      "insert into variants (id, post_id, channel_id, caption, hashtags, media_ids, spec_state, revision, created_at, updated_at) values (?, ?, ?, 'threads text', '[\"#one\"]', '[]', 'ok', 0, ?, ?)",
    ).bind(VAR_THREADS, POST, CH_THREADS, now, now),
    env.DB.prepare(
      "insert into variants (id, post_id, channel_id, caption, hashtags, media_ids, spec_state, revision, created_at, updated_at) values (?, ?, ?, 'other workspace', '[]', '[]', 'ok', 0, ?, ?)",
    ).bind(OTHER_VARIANT, OTHER_POST, CH_TIKTOK, now, now),
  ]);
}

async function approveTiktok() {
  const granted = await approvals(baseEnv).approve(ctx, VAR_TIKTOK, { slotAt: Date.now() });
  if (!granted.ok) throw new Error(`seed: approve failed (${granted.error})`);
}

describe("a pack is everything the operator needs to post by hand", () => {
  beforeEach(seed);

  it("carries the caption, the hashtags, the assets in order, a checklist and the reason", async () => {
    const read = await tiktokStore(withPublicMedia).read(ctx, VAR_TIKTOK);
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    const { pack } = read;
    expect(pack.caption).toBe(CAPTION);
    expect(pack.hashtags).toEqual(HASHTAGS);
    expect(pack.assets.map((asset) => asset.mediaId)).toEqual([R2_VIDEO, VAULT_VIDEO]);
    expect(pack.checklist.length).toBeGreaterThanOrEqual(3);
    expect(pack.checklist.join(" ")).toContain("copy the post's URL");
    expect(pack.reason).toBe(TIKTOK_REASON);
    expect(pack.reason).toContain("guidelines");
  });

  it("labels what is a stored path and what is a public URL", async () => {
    const read = await tiktokStore(withPublicMedia).read(ctx, VAR_TIKTOK);
    if (!read.ok) throw new Error("pack missing");

    expect(read.pack.assets[0]).toEqual({
      mediaId: R2_VIDEO,
      kind: "video",
      path: `media/${WS}/clip.mp4`,
      url: `https://media.test/media/${WS}/clip.mp4`,
    });
    // A vault path is still the file's address for a human; it is not a URL anything can fetch.
    expect(read.pack.assets[1].path).toBe("brands/tiktok/queue/item/clip-2.mp4");
    expect(read.pack.assets[1].url).toBeNull();
  });

  it("publishes nothing and records nothing: a pack is not an attempt", async () => {
    await tiktokStore(withPublicMedia).read(ctx, VAR_TIKTOK);

    const post = await env.DB.prepare("select status from posts where id = ?")
      .bind(POST)
      .first<{ status: string }>();
    expect(post?.status).toBe("review");

    const results = await env.DB.prepare("select count(*) as n from publish_results").first<{ n: number }>();
    expect(Number(results?.n)).toBe(0);
  });
});

describe("completion is recorded by a human, and published only then", () => {
  beforeEach(seed);

  it("records the URL, moves the post to published, and leaves one audit row", async () => {
    await approveTiktok();
    const url = "https://www.tiktok.com/@brand/video/7311111111111111111";

    const done = await tiktokStore(baseEnv).complete(ctx, VAR_TIKTOK, url);
    expect(done).toEqual({ ok: true, url });

    const result = await env.DB.prepare(
      "select state, url, platform, platform_post_id from publish_results where variant_id = ?",
    )
      .bind(VAR_TIKTOK)
      .first<{ state: string; url: string; platform: string; platform_post_id: string | null }>();
    expect(result?.state).toBe("succeeded");
    expect(result?.url).toBe(url);
    expect(result?.platform).toBe("tiktok");
    // The operator gave a link, not the platform's id — inventing one would be a lie in the record.
    expect(result?.platform_post_id).toBeNull();

    const post = await env.DB.prepare("select status from posts where id = ?")
      .bind(POST)
      .first<{ status: string }>();
    expect(post?.status).toBe("published");

    const audit = await env.DB.prepare("select action, detail from activity_log where post_id = ? and action = ?")
      .bind(POST, "publish.manual_completed")
      .first<{ action: string; detail: string }>();
    expect(JSON.parse(audit!.detail)).toMatchObject({ variantId: VAR_TIKTOK, url });
  });

  it("settles the parked job instead of polling TikTok for a post already shipped", async () => {
    await approveTiktok();
    const before = await env.DB.prepare("select state from jobs").first<{ state: string }>();
    expect(before?.state).toBe("queued");

    await tiktokStore(baseEnv).complete(ctx, VAR_TIKTOK, "https://www.tiktok.com/@brand/video/7311111111111111112");

    const after = await env.DB.prepare("select state from jobs").first<{ state: string }>();
    expect(after?.state).toBe("done");
  });

  it("refuses a URL for content that changed after it was approved", async () => {
    await approveTiktok();
    await env.DB.prepare("update variants set caption = 'edited after approval' where id = ?")
      .bind(VAR_TIKTOK)
      .run();

    const done = await tiktokStore(baseEnv).complete(ctx, VAR_TIKTOK, "https://www.tiktok.com/@brand/video/731");
    expect(done).toEqual({ ok: false, reason: "reapproval_required" });

    const results = await env.DB.prepare("select count(*) as n from publish_results").first<{ n: number }>();
    expect(Number(results?.n)).toBe(0);

    const post = await env.DB.prepare("select status from posts where id = ?")
      .bind(POST)
      .first<{ status: string }>();
    expect(post?.status).not.toBe("published");
  });

  it("refuses a second record of the same post: one success per variant, ever", async () => {
    await approveTiktok();
    const first = await tiktokStore(baseEnv).complete(ctx, VAR_TIKTOK, "https://www.tiktok.com/@brand/video/7311");
    expect(first.ok).toBe(true);

    const second = await tiktokStore(baseEnv).complete(ctx, VAR_TIKTOK, "https://www.tiktok.com/@brand/video/7312");
    expect(second).toEqual({ ok: false, reason: "already_published" });

    const counted = await env.DB.prepare(
      "select count(*) as n from publish_results where variant_id = ? and state = 'succeeded'",
    )
      .bind(VAR_TIKTOK)
      .first<{ n: number }>();
    expect(Number(counted?.n)).toBe(1);

    const stored = await env.DB.prepare("select url from publish_results where variant_id = ?")
      .bind(VAR_TIKTOK)
      .first<{ url: string }>();
    expect(stored?.url).toBe("https://www.tiktok.com/@brand/video/7311");
  });

  it("refuses to move an archived post forwards into published", async () => {
    await approveTiktok();
    await env.DB.prepare("update posts set status = 'archived' where id = ?").bind(POST).run();

    const done = await tiktokStore(baseEnv).complete(ctx, VAR_TIKTOK, "https://www.tiktok.com/@brand/video/7313");
    expect(done).toEqual({ ok: false, reason: "archived" });
  });
});

describe("only a TikTok target has a pack", () => {
  beforeEach(seed);

  it("refuses a variant that publishes itself", async () => {
    const read = await tiktokStore(baseEnv).read(ctx, VAR_THREADS);
    expect(read).toEqual({ ok: false, reason: "not_tiktok" });

    const done = await tiktokStore(baseEnv).complete(ctx, VAR_THREADS, "https://threads.test/p/1");
    expect(done).toEqual({ ok: false, reason: "not_tiktok" });
  });

  it("answers not_found for another workspace's variant, and writes nothing", async () => {
    expect(await tiktokStore(baseEnv).read(ctx, OTHER_VARIANT)).toEqual({ ok: false, reason: "not_found" });
    expect(await tiktokStore(baseEnv).complete(ctx, OTHER_VARIANT, "https://www.tiktok.com/@x/video/1")).toEqual({
      ok: false,
      reason: "not_found",
    });
    // and the owner of that variant still cannot reach this workspace's rows either
    expect(await tiktokStore(baseEnv).read(otherCtx, VAR_TIKTOK)).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("the guideline reason travels with the target", () => {
  beforeEach(seed);

  it("is on every variant row the board, the review queue and the post detail return", async () => {
    const repo = repository(baseEnv);

    const detail = await repo.getPostDetail(ctx, POST);
    const detailTiktok = detail?.variants.find((variant) => variant.id === VAR_TIKTOK);
    const detailThreads = detail?.variants.find((variant) => variant.id === VAR_THREADS);
    expect(detailTiktok?.note).toBe(TIKTOK_REASON);
    expect(detailThreads?.note).toBeNull();

    const board = await repo.listBoard(ctx, { brandId: BRAND });
    expect(board.variants.find((variant) => variant.id === VAR_TIKTOK)?.note).toBe(TIKTOK_REASON);

    const queue = await repo.listReviewQueue(ctx, { brandId: BRAND });
    expect(queue.variants.find((variant) => variant.id === VAR_TIKTOK)?.note).toBe(TIKTOK_REASON);
  });

  it("and the dry run already carries it, so a preview repeats the line too", async () => {
    // The refusing adapter's preview notes are the same sentence — one string, two surfaces.
    const { tiktokRefusal } = await import("@/publishers/tiktok");
    const preview = await tiktokRefusal().preview({
      variantId: VAR_TIKTOK,
      platform: "tiktok",
      channelId: CH_TIKTOK,
      accountRef: "tt-1",
      caption: CAPTION,
      hashtags: HASHTAGS,
      media: [],
      credentials: {},
    });
    expect(preview.notes).toEqual([TIKTOK_REASON]);
    expect(preview.calls).toEqual([]);
  });
});
