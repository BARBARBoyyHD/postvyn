/**
 * The media purge, against real D1 and real R2.
 *
 * The rules that matter are the ones about what is **not** deleted: a variant's media, a published
 * post's media, anything inside the window. So those cases come first, the deletions second, and the
 * dry run is asserted against the same bucket a real run would empty — a mocked report would prove
 * nothing about what the sweep actually reaches.
 *
 * Object age is `uploaded`, which R2 stamps at write time and no test can backdate. The old-object
 * cases therefore move the sweep's clock forward instead of the object's: `now` is the sweep's only
 * notion of age, so a sweep "a month from now" is the same code path the cron takes in a month.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEDIA_RETENTION_MS, mediaPurge, runMediaPurge, type PurgeBucket, type PurgeCandidate } from "@/db/media-purge";
import { systemContext } from "@/lib/context";
import type { WorkerEnv } from "@/lib/env";

const WS = "ws-purge";
const OTHER_WS = "ws-purge-other";
const BRAND = "brand-purge";
const CHANNEL = "chn-purge";
const POST = "post-purge";
const VARIANT = "var-purge";

const testEnv: WorkerEnv = { DB: env.DB, MEDIA: env.MEDIA };

/** An id per candidate, so an assertion reads as the thing a human would recognise. */
const keysOf = (items: PurgeCandidate[]) =>
  items.map((item) => (item.reason === "non_postable_media" ? item.mediaId : item.key));

/** A month after the test runs: everything uploaded now is past the window. */
const NEXT_MONTH = Date.now() + MEDIA_RETENTION_MS + 60_000;
/** A row old enough to be a candidate at the real clock. */
const LAST_MONTH = Date.now() - MEDIA_RETENTION_MS - 60_000;

async function reset() {
  await env.DB.batch([
    env.DB.prepare("delete from publish_results"),
    env.DB.prepare("delete from variants"),
    env.DB.prepare("delete from posts"),
    env.DB.prepare("delete from channels"),
    env.DB.prepare("delete from brands"),
    env.DB.prepare("delete from media"),
  ]);

  const listed = await env.MEDIA.list();
  for (const object of listed.objects) await env.MEDIA.delete(object.key);

  const now = Date.now();
  for (const [id, name] of [
    [WS, "Purge"],
    [OTHER_WS, "Purge other"],
  ]) {
    await env.DB.prepare(
      "insert or ignore into workspaces (id, name, plan, timezone, publishing_enabled, created_at, updated_at) values (?, ?, 'free', 'UTC', 1, ?, ?)",
    )
      .bind(id, name, now, now)
      .run();
  }
}

interface MediaSeed {
  id: string;
  key: string;
  workspaceId?: string;
  postable?: boolean;
  createdAt: number;
  bytes: number;
  /** Whether the row's bytes really exist in the bucket. */
  object?: boolean;
}

async function seedMedia(input: MediaSeed) {
  const workspaceId = input.workspaceId ?? WS;
  await env.DB.prepare(
    "insert into media (id, workspace_id, hash, key, mime, bytes, postable, created_at) values (?, ?, ?, ?, 'image/png', ?, ?, ?)",
  )
    .bind(input.id, workspaceId, `hash-${input.id}`, input.key, input.bytes, input.postable ? 1 : 0, input.createdAt)
    .run();
  if (input.object) await env.MEDIA.put(input.key, new Uint8Array(input.bytes));
}

/** The rows a reference needs: brand → channel → post → variant that names `mediaIds`. */
async function seedVariant(mediaIds: string[], options: { published?: boolean } = {}) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "insert or ignore into brands (id, workspace_id, slug, name, created_at, updated_at) values (?, ?, 'purge', 'Purge', ?, ?)",
    ).bind(BRAND, WS, now, now),
    env.DB.prepare(
      "insert or ignore into channels (id, brand_id, platform, account_ref, status, created_at, updated_at) values (?, ?, 'instagram', 'ig-purge', 'active', ?, ?)",
    ).bind(CHANNEL, BRAND, now, now),
    env.DB.prepare(
      "insert or ignore into posts (id, workspace_id, brand_id, title, format, status, created_at, updated_at) values (?, ?, ?, 'Purge post', 'image', 'published', ?, ?)",
    ).bind(POST, WS, BRAND, now, now),
    env.DB.prepare(
      "insert or replace into variants (id, post_id, channel_id, caption, hashtags, media_ids, spec_state, revision, created_at, updated_at) values (?, ?, ?, 'caption', '[]', ?, 'ok', 0, ?, ?)",
    ).bind(VARIANT, POST, CHANNEL, JSON.stringify(mediaIds), now, now),
  ]);

  if (options.published) {
    await env.DB.prepare(
      "insert into publish_results (id, variant_id, platform, platform_post_id, url, raw, state, created_at) values ('pub-purge', ?, 'instagram', 'ig-1', 'https://instagram.test/p/1', null, 'succeeded', ?)",
    )
      .bind(VARIANT, now)
      .run();
  }
}

describe("what the purge refuses to touch", () => {
  beforeEach(reset);

  it("leaves media a variant still points at, however old it is", async () => {
    await seedMedia({ id: "med-referenced", key: `media/${WS}/referenced.png`, postable: false, createdAt: LAST_MONTH, bytes: 1024, object: true });
    await seedVariant(["med-referenced"]);

    const report = await mediaPurge(testEnv).sweep(systemContext(WS));
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(report.candidates).toEqual([]);
    expect(report.deleted).toEqual([]);
    expect(await env.MEDIA.head(`media/${WS}/referenced.png`)).not.toBeNull();
    const row = await env.DB.prepare("select id from media where id = 'med-referenced'").first<{ id: string }>();
    expect(row?.id).toBe("med-referenced");
  });

  it("leaves the media of a published post alone", async () => {
    await seedMedia({ id: "med-published", key: `media/${WS}/published.png`, postable: false, createdAt: LAST_MONTH, bytes: 2048, object: true });
    await seedVariant(["med-published"], { published: true });

    const report = await mediaPurge(testEnv).sweep(systemContext(WS));
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(report.deleted).toEqual([]);
    expect(await env.MEDIA.head(`media/${WS}/published.png`)).not.toBeNull();
    const published = await env.DB.prepare(
      "select count(*) as n from publish_results where id = 'pub-purge' and state = 'succeeded'",
    ).first<{ n: number }>();
    expect(published?.n).toBe(1);
  });

  it("sweeps only the workspace it was handed", async () => {
    await seedMedia({ id: "med-mine", key: `media/${WS}/mine.png`, postable: false, createdAt: LAST_MONTH, bytes: 512, object: true });
    await seedMedia({
      id: "med-theirs",
      workspaceId: OTHER_WS,
      key: `media/${OTHER_WS}/theirs.png`,
      postable: false,
      createdAt: LAST_MONTH,
      bytes: 512,
      object: true,
    });

    const report = await mediaPurge(testEnv).sweep(systemContext(WS));
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(keysOf(report.deleted)).toEqual(["med-mine"]);
    expect(await env.MEDIA.head(`media/${OTHER_WS}/theirs.png`)).not.toBeNull();
  });

  it("does not touch an object younger than the window, even with no row", async () => {
    // What a minted-but-unrecorded upload looks like: a key in the bucket, no row, minutes old.
    const key = `media/${WS}/upl_inflight.png`;
    await env.MEDIA.put(key, new Uint8Array(16));

    const report = await mediaPurge(testEnv).sweep(systemContext(WS));
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(report.candidates).toEqual([]);
    expect(await env.MEDIA.head(key)).not.toBeNull();
  });
});

describe("what the purge deletes", () => {
  beforeEach(reset);

  it("deletes a non-postable row and its object once it is past the window", async () => {
    const key = `media/${WS}/contact-sheet.png`;
    await seedMedia({ id: "med-old", key, postable: false, createdAt: LAST_MONTH, bytes: 4096, object: true });

    const report = await mediaPurge(testEnv).sweep(systemContext(WS));
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(report.candidates).toEqual([
      { reason: "non_postable_media", workspaceId: WS, mediaId: "med-old", key, bytes: 4096 },
    ]);
    expect(report.deleted).toHaveLength(1);
    expect(report.failed).toEqual([]);
    expect(await env.MEDIA.head(key)).toBeNull();
    const row = await env.DB.prepare("select id from media where id = 'med-old'").first<{ id: string }>();
    expect(row).toBeNull();
  });

  it("leaves a postable asset alone even when nothing references it", async () => {
    // The rule is "unreferenced **and** postable = false" (docs/003-ITA.md §5): an asset nobody has
    // attached yet is still the operator's work.
    const key = `media/${WS}/unused-but-postable.png`;
    await seedMedia({ id: "med-postable", key, postable: true, createdAt: LAST_MONTH, bytes: 4096, object: true });

    const report = await mediaPurge(testEnv).sweep(systemContext(WS));
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(report.candidates).toEqual([]);
    expect(await env.MEDIA.head(key)).not.toBeNull();
  });

  it("deletes an object no row names, once the window has passed", async () => {
    const key = `media/${WS}/orphan.png`;
    await env.MEDIA.put(key, new Uint8Array(2048));

    const report = await runMediaPurge(testEnv, { now: NEXT_MONTH });
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(report.deleted).toEqual([{ reason: "orphan_object", workspaceId: WS, key, bytes: 2048 }]);
    expect(await env.MEDIA.head(key)).toBeNull();
  });

  it("runs over every workspace on the cron", async () => {
    await seedMedia({ id: "med-a", key: `media/${WS}/a.png`, postable: false, createdAt: LAST_MONTH, bytes: 100, object: true });
    await seedMedia({
      id: "med-b",
      workspaceId: OTHER_WS,
      key: `media/${OTHER_WS}/b.png`,
      postable: false,
      createdAt: LAST_MONTH,
      bytes: 100,
      object: true,
    });

    const report = await runMediaPurge(testEnv);
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(report.deleted).toHaveLength(2);
    expect(await env.MEDIA.head(`media/${WS}/a.png`)).toBeNull();
    expect(await env.MEDIA.head(`media/${OTHER_WS}/b.png`)).toBeNull();
  });
});

describe("a dry run", () => {
  beforeEach(reset);

  it("lists the same keys and sizes and deletes nothing", async () => {
    const key = `media/${WS}/preview.png`;
    await seedMedia({ id: "med-dry", key, postable: false, createdAt: LAST_MONTH, bytes: 8192, object: true });

    const lines = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const report = await mediaPurge(testEnv).sweep(systemContext(WS), { dryRun: true });
    // `mockRestore` clears the record, so read it before restoring.
    const logged = lines.mock.calls.map((call) => String(call[1]));
    lines.mockRestore();

    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(report.dryRun).toBe(true);
    expect(report.candidates).toEqual([
      { reason: "non_postable_media", workspaceId: WS, mediaId: "med-dry", key, bytes: 8192 },
    ]);
    expect(report.deleted).toEqual([]);

    // "Deletion is recorded before it happens": one line, with what and how much — even in a dry run.
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(key);

    expect(await env.MEDIA.head(key)).not.toBeNull();
    const row = await env.DB.prepare("select id from media where id = 'med-dry'").first<{ id: string }>();
    expect(row?.id).toBe("med-dry");
  });

  it("records the plan before it deletes, and says nothing when there is nothing to do", async () => {
    const key = `media/${WS}/preview.png`;
    await seedMedia({ id: "med-log", key, postable: false, createdAt: LAST_MONTH, bytes: 8192, object: true });

    const logged = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await mediaPurge(testEnv).sweep(systemContext(WS));
    expect(logged.mock.calls).toHaveLength(1);
    expect(String(logged.mock.calls[0]?.[1])).toContain(key);
    logged.mockRestore();

    const noise = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")].map((spy) =>
      spy.mockImplementation(() => undefined),
    );
    const idle = await runMediaPurge(testEnv);
    expect(idle).toMatchObject({ ok: true, candidates: [], deleted: [], failed: [] });
    expect(noise.flatMap((spy) => spy.mock.calls)).toEqual([]);
    for (const spy of noise) spy.mockRestore();
  });
});

describe("when the store refuses", () => {
  beforeEach(reset);

  it("reports the failure and reclaims everything else", async () => {
    const locked = `media/${WS}/locked.png`;
    const fine = `media/${WS}/fine.png`;
    await seedMedia({ id: "med-locked", key: locked, postable: false, createdAt: LAST_MONTH, bytes: 128, object: true });
    await seedMedia({ id: "med-fine", key: fine, postable: false, createdAt: LAST_MONTH, bytes: 128, object: true });

    const refusing: PurgeBucket = {
      async delete(keys) {
        if (keys === locked) throw new Error("R2 refused");
        await env.MEDIA.delete(keys);
      },
      list: (options) => env.MEDIA.list(options),
    };

    const report = await mediaPurge(testEnv).sweep(systemContext(WS), { bucket: refusing });
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(keysOf(report.failed.map((failure) => failure.item))).toEqual(["med-locked"]);
    expect(report.failed[0]?.error).toContain("R2 refused");
    expect(keysOf(report.deleted)).toEqual(["med-fine"]);

    // Row first, object second: the failed object is now an orphan, which the next sweep reclaims.
    const row = await env.DB.prepare("select id from media where id = 'med-locked'").first<{ id: string }>();
    expect(row).toBeNull();
    expect(await env.MEDIA.head(locked)).not.toBeNull();
    expect(await env.MEDIA.head(fine)).toBeNull();
  });

  it("answers with a reason when there is no bucket, rather than throwing", async () => {
    const report = await runMediaPurge({ DB: env.DB });
    expect(report).toEqual({
      ok: false,
      reason: "no_bucket",
      message: expect.stringContaining("MEDIA"),
    });
  });
});
