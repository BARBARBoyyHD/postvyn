/**
 * Intake, end to end, against real D1 and real R2 (miniflare).
 *
 * Two halves, both tested against the thing that can fail. A stub bucket would prove nothing about an
 * upload that writes an object, strips it and reads the size back; and a draft is only interesting once
 * it is a row with a verdict attached.
 *
 * The bytes parsing itself (sniffing, stripping, dimensions) is unit-tested in `media.test.ts` — here
 * the question is what the path does with them.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { intake } from "@/db/intake";
import { uploadStore } from "@/db/media-upload";
import { sha256Hex, stripMetadata } from "@/lib/media/bytes";
import { contextForScope } from "@/lib/agent-token";
import type { WorkerEnv } from "@/lib/env";

const testEnv: WorkerEnv = {
  DB: env.DB,
  MEDIA: env.MEDIA,
  R2_PUBLIC_BASE: "https://media.test",
  R2_ACCOUNT_ID: "account",
  R2_ACCESS_KEY_ID: "AKIAEXAMPLE",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "postvyn-bucket",
};

const WS = "ws-intake";
const OTHER_WS = "ws-intake-other";
const BRAND = "brand-intake";
const CHANNEL = "chn-intake";
const ctx = contextForScope({
  tokenId: "tok_test",
  label: "test",
  workspaceId: WS,
  brandId: BRAND,
  role: "editor",
});
const otherCtx = { ...ctx, workspaceId: OTHER_WS };

/** A 1×1 PNG — real header, real IDAT, enough for the sniffer and the dimension reader. */
const PLAIN_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00,
  0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00,
  0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
  0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

/** The same PNG with a `tEXt` chunk after IHDR — a comment, which the strip must remove. */
const TEXT_CHUNK = new Uint8Array([
  0x00, 0x00, 0x00, 0x0a, 0x74, 0x45, 0x58, 0x74, 0x43, 0x6f, 0x6d, 0x6d, 0x65, 0x6e, 0x74, 0x00, 0x68,
  0x69, 0x00, 0x00, 0x00, 0x00,
]);

const PNG = new Uint8Array([
  ...PLAIN_PNG.subarray(0, 33),
  ...TEXT_CHUNK,
  ...PLAIN_PNG.subarray(33),
]);

/** SOI, APP1 (`Exif` + GPS-ish TIFF header), SOF0 at 640×480, SOS, EOI. */
const JPEG_WITH_EXIF = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a, 0x00,
  0x00, 0x00, 0x08, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0x01, 0x11, 0x00, 0x02,
  0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0x34,
  0xff, 0xd9,
]);

const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

/** Mint, play the browser (PUT via the binding), then record — the three steps the routes expose. */
async function upload(
  store: ReturnType<typeof uploadStore>,
  target: typeof ctx,
  bytes: Uint8Array,
  mime: string,
  options: { filename?: string; claims?: { width?: number; height?: number } } = {},
) {
  const minted = await store.mint(target, {
    filename: options.filename ?? "asset",
    mime,
    bytes: bytes.byteLength,
  });
  if (!minted.ok) return minted;

  await env.MEDIA.put(minted.key, bytes, { httpMetadata: { contentType: mime } });
  return store.record(target, minted.uploadId, { mime, ...options.claims });
}

describe("minting an upload URL", () => {
  it("signs one key, one content type and a short expiry, and points at the bucket", async () => {
    const minted = await uploadStore(testEnv).mint(ctx, {
      filename: "pixel.png",
      mime: "image/png",
      bytes: 1024,
    });

    expect(minted.ok).toBe(true);
    if (!minted.ok) return;

    expect(minted.key).toBe(`media/${WS}/${minted.uploadId}.png`);
    expect(minted.expiresAt).toBeGreaterThan(Date.now());

    const url = new URL(minted.url);
    expect(url.pathname).toBe(`/postvyn-bucket/${minted.key}`);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-type;host");
    expect(Number(url.searchParams.get("X-Amz-Expires"))).toBeLessThanOrEqual(600);
  });

  it("refuses an oversize file before a URL exists — even with no storage configured", async () => {
    // No R2 credentials at all: the size check runs first, so the answer names the size, not the config.
    const unconfigured: WorkerEnv = { DB: env.DB };
    const minted = await uploadStore(unconfigured).mint(ctx, {
      filename: "huge.mp4",
      mime: "video/mp4",
      bytes: 25 * 1024 * 1024 + 1,
    });

    expect(minted).toMatchObject({ ok: false, code: "too_large" });
    if (minted.ok) return;
    expect(minted.message).toContain("MB");
  });

  it("refuses an SVG by policy, naming the reason", async () => {
    const minted = await uploadStore(testEnv).mint(ctx, {
      filename: "logo.svg",
      mime: "image/svg+xml",
      bytes: SVG.byteLength,
    });

    expect(minted).toMatchObject({ ok: false, code: "unsupported_type" });
    if (minted.ok) return;
    expect(minted.message).toMatch(/SVG can carry script/);
  });

  it("refuses an empty file and a type nobody accepts", async () => {
    const store = uploadStore(testEnv);
    expect(await store.mint(ctx, { filename: "nothing.png", mime: "image/png", bytes: 0 })).toMatchObject({
      ok: false,
      code: "empty_file",
    });
    expect(await store.mint(ctx, { filename: "doc.pdf", mime: "application/pdf", bytes: 10 })).toMatchObject({
      ok: false,
      code: "unsupported_type",
    });
  });

  it("says which variables are missing instead of half-working", async () => {
    const minted = await uploadStore({ DB: env.DB }).mint(ctx, {
      filename: "pixel.png",
      mime: "image/png",
      bytes: 10,
    });

    expect(minted).toMatchObject({ ok: false, code: "storage_unconfigured" });
    if (minted.ok) return;
    expect(minted.message).toContain("R2_ACCOUNT_ID");
    expect(minted.message).toContain("MEDIA");
  });
});

describe("recording what landed", () => {
  beforeEach(async () => {
    // No cascading deletes: `activity_log` is append-only by trigger (migration 0012), so deleting a
    // workspace aborts — which is the rule working, not the test being wrong. Seed idempotently instead.
    await env.DB.prepare("delete from media").run();
    await env.DB.prepare("delete from variants").run();
    await env.DB.prepare("delete from channels").run();

    const now = Date.now();
    await env.DB.prepare(
      "insert or ignore into workspaces (id, name, plan, timezone, publishing_enabled, created_at, updated_at) values (?, ?, 'free', 'UTC', 0, ?, ?)",
    )
      .bind(WS, "Intake", now, now)
      .run();
    await env.DB.prepare(
      "insert or ignore into workspaces (id, name, plan, timezone, publishing_enabled, created_at, updated_at) values (?, ?, 'free', 'UTC', 0, ?, ?)",
    )
      .bind(OTHER_WS, "Intake other", now, now)
      .run();
    await env.DB.prepare(
      "insert or ignore into brands (id, workspace_id, slug, name, created_at, updated_at) values (?, ?, 'probe', 'Probe', ?, ?)",
    )
      .bind(BRAND, WS, now, now)
      .run();
    await env.DB.prepare(
      "insert or ignore into channels (id, brand_id, platform, account_ref, status, created_at, updated_at) values (?, ?, 'tiktok', 'probe', 'active', ?, ?)",
    )
      .bind(CHANNEL, BRAND, now, now)
      .run();
  });

  it("records the stripped bytes: size, hash and dimensions come from the object", async () => {
    const recorded = await upload(uploadStore(testEnv), ctx, PNG, "image/png", { filename: "pixel.png" });

    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;

    const stripped = stripMetadata(PNG, "image/png");
    expect(recorded.media.mime).toBe("image/png");
    expect(recorded.media.bytes).toBe(stripped.byteLength);
    expect(recorded.media.bytes).toBeLessThan(PNG.byteLength);
    expect(recorded.media.hash).toBe(await sha256Hex(stripped));
    expect(recorded.media.width).toBe(1);
    expect(recorded.media.height).toBe(1);
    expect(recorded.url).toBe(`https://media.test/${recorded.media.key}`);

    // The object R2 now serves is the stripped one, at a content-addressed key.
    expect(recorded.media.key).toBe(`media/${WS}/${recorded.media.hash}.png`);
    const stored = await env.MEDIA.get(recorded.media.key);
    expect(stored?.size).toBe(stripped.byteLength);
    expect(stored?.httpMetadata?.contentType).toBe("image/png");
  });

  it("strips EXIF before the object is retrievable, and the URL serves the stripped file", async () => {
    const recorded = await upload(uploadStore(testEnv), ctx, JPEG_WITH_EXIF, "image/jpeg", {
      filename: "office.jpg",
    });

    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;

    const stored = await env.MEDIA.get(recorded.media.key);
    if (!stored) throw new Error("the recorded object is missing");
    const served = new Uint8Array(await stored.arrayBuffer());

    expect(new TextDecoder().decode(served)).not.toContain("Exif");
    expect(served.byteLength).toBe(JPEG_WITH_EXIF.byteLength - 18);
    expect(recorded.media.bytes).toBe(served.byteLength);
    expect(recorded.media.width).toBe(640);
    expect(recorded.media.height).toBe(480);
  });

  it("refuses a declared type the bytes disagree with, and keeps nothing", async () => {
    const store = uploadStore(testEnv);
    const minted = await store.mint(ctx, { filename: "photo.png", mime: "image/png", bytes: JPEG_WITH_EXIF.byteLength });
    if (!minted.ok) throw new Error("mint failed");

    // A JPEG uploaded under a PNG's name: the claim is refused, and the object is discarded.
    await env.MEDIA.put(minted.key, JPEG_WITH_EXIF);
    const recorded = await store.record(ctx, minted.uploadId, { mime: "image/png" });

    expect(recorded).toMatchObject({ ok: false, code: "type_mismatch" });
    if (recorded.ok) return;
    expect(recorded.message).toContain("image/png");
    expect(recorded.message).toContain("image/jpeg");
    expect(await env.MEDIA.get(minted.key)).toBeNull();

    const row = await env.DB.prepare("select id from media where workspace_id = ?").bind(WS).first();
    expect(row).toBeNull();
  });

  it("refuses dimensions the header does not have, rather than averaging the two", async () => {
    const recorded = await upload(uploadStore(testEnv), ctx, PNG, "image/png", {
      claims: { width: 1080, height: 1350 },
    });

    expect(recorded).toMatchObject({ ok: false, code: "dimensions_mismatch" });
    if (recorded.ok) return;
    expect(recorded.message).toContain("1080×1350");
    expect(recorded.message).toContain("1×1");
  });

  it("refuses an object above the ceiling that a client ignored", async () => {
    const store = uploadStore(testEnv);
    const minted = await store.mint(ctx, { filename: "liar.png", mime: "image/png", bytes: 100 });
    if (!minted.ok) throw new Error("mint failed");

    const oversized = new Uint8Array(25 * 1024 * 1024 + 1);
    oversized.set(PNG, 0);
    await env.MEDIA.put(minted.key, oversized);

    const recorded = await store.record(ctx, minted.uploadId, { mime: "image/png" });
    expect(recorded).toMatchObject({ ok: false, code: "too_large" });
    expect(await env.MEDIA.get(minted.key)).toBeNull();
  });

  it("refuses a record for an upload that never arrived", async () => {
    const store = uploadStore(testEnv);
    const minted = await store.mint(ctx, { filename: "ghost.png", mime: "image/png", bytes: 1000 });
    if (!minted.ok) throw new Error("mint failed");

    const recorded = await store.record(ctx, minted.uploadId, { mime: "image/png" });
    expect(recorded).toMatchObject({ ok: false, code: "upload_missing" });
    if (recorded.ok) return;
    expect(recorded.message).toContain(minted.key);
  });
});

describe("the same bytes are stored once per workspace", () => {
  beforeEach(async () => {
    await env.DB.prepare("delete from media").run();
  });

  it("a second upload of the same file is a lookup, not a second object", async () => {
    const store = uploadStore(testEnv);
    const first = await upload(store, ctx, PNG, "image/png");
    const second = await upload(store, ctx, PNG, "image/png");

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.deduplicated).toBe(true);
    expect(second.media.id).toBe(first.media.id);

    const count = await env.DB.prepare("select count(*) as n from media where workspace_id = ?")
      .bind(WS)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);

    // One object for those bytes — the second upload wrote nothing, and its landing key was cleaned up.
    const listed = await env.MEDIA.list({ prefix: `media/${WS}/${first.media.hash}` });
    expect(listed.objects.map((object) => object.key)).toEqual([first.media.key]);
  });

  it("the same bytes in another workspace are another row and another object", async () => {
    const store = uploadStore(testEnv);
    const mine = await upload(store, ctx, PNG, "image/png");
    const theirs = await upload(store, otherCtx, PNG, "image/png");

    expect(mine.ok && theirs.ok).toBe(true);
    if (!mine.ok || !theirs.ok) return;

    expect(theirs.deduplicated).toBe(false);
    expect(theirs.media.id).not.toBe(mine.media.id);
    expect(theirs.media.key).toBe(`media/${OTHER_WS}/${theirs.media.hash}.png`);

    const rows = await env.DB.prepare("select count(*) as n from media").first<{ n: number }>();
    expect(rows?.n).toBe(2);
  });

  it("re-uploading an imported row's bytes gives it an R2 key without losing the vault path", async () => {
    const store = uploadStore(testEnv);
    const hash = await sha256Hex(stripMetadata(PNG, "image/png"));
    // What the importer wrote: the vault's own path, which R2 cannot serve.
    const vaultPath = "brands/uwi/social/tiktok/queue/0001/pixel.png";
    await env.DB.prepare(
      "insert into media (id, workspace_id, hash, key, mime, bytes, width, height, postable) values (?, ?, ?, ?, 'image/png', 66, 1, 1, 1)",
    )
      .bind("med_imported", WS, hash, vaultPath)
      .run();

    const recorded = await upload(store, ctx, PNG, "image/png");
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;

    expect(recorded.deduplicated).toBe(true);
    expect(recorded.media.id).toBe("med_imported");
    // The path stays (an import dispute is worse than an ugly field); the key is what makes it serveable.
    expect(recorded.media.key).toBe(vaultPath);
    expect(recorded.media.r2Key).toBe(`media/${WS}/${hash}.png`);
    expect(recorded.url).toBe(`https://media.test/media/${WS}/${hash}.png`);
    expect(await env.MEDIA.get(`media/${WS}/${hash}.png`)).not.toBeNull();
  });
});

describe("drafts", () => {
  beforeEach(async () => {
    // No cascading deletes: `activity_log` is append-only by trigger (migration 0012), so deleting a
    // workspace aborts — which is the rule working, not the test being wrong. Seed idempotently instead.
    await env.DB.prepare("delete from media").run();
    await env.DB.prepare("delete from variants").run();
    await env.DB.prepare("delete from channels").run();

    const now = Date.now();
    await env.DB.prepare("insert or ignore into workspaces (id, name, plan, timezone, publishing_enabled, created_at, updated_at) values (?, ?, 'free', 'UTC', 0, ?, ?)")
      .bind(WS, "Intake", now, now)
      .run();
    await env.DB.prepare("insert or ignore into brands (id, workspace_id, slug, name, created_at, updated_at) values (?, ?, 'probe', 'Probe', ?, ?)")
      .bind(BRAND, WS, now, now)
      .run();
    await env.DB.prepare("insert or ignore into channels (id, brand_id, platform, account_ref, status, created_at, updated_at) values (?, ?, 'tiktok', 'probe', 'active', ?, ?)")
      .bind(CHANNEL, BRAND, now, now)
      .run();
  });

  it("lands in review with the verdict attached, naming the platform not an id", async () => {
    const result = await intake(testEnv).createDraft(ctx, BRAND, {
      title: "Intake probe",
      format: "reel",
      targets: [
        {
          platform: "tiktok",
          caption: "The stock report said 128. The shelf said 92.",
          hashtags: ["#inventory", "#ops"],
          mediaIds: [],
        },
      ],
    });

    expect(result.status).toBe("review");
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0].specState).toBe("ok");
    expect(result.targets[0].channelId).toBe(CHANNEL);

    const row = await env.DB.prepare("select status from posts where id = ?").bind(result.postId).first<{ status: string }>();
    expect(row?.status).toBe("review");
  });

  it("creates the post even when the caption is blocked, and says so", async () => {
    const result = await intake(testEnv).createDraft(ctx, BRAND, {
      title: "Too long",
      format: "reel",
      targets: [
        {
          platform: "tiktok",
          caption: "a".repeat(2300),
          hashtags: [],
          mediaIds: [],
        },
      ],
    });

    expect(result.targets[0].specState).toBe("blocked");
    const row = await env.DB.prepare("select status from posts where id = ?").bind(result.postId).first<{ status: string }>();
    expect(row?.status).toBe("review");
  });

  it("reports an unknown platform per target instead of failing the whole call", async () => {
    const result = await intake(testEnv).createDraft(ctx, BRAND, {
      title: "Wrong channel",
      format: "single",
      targets: [
        { platform: "tiktok", caption: "fine", hashtags: ["#a"], mediaIds: [] },
        { platform: "myspace", caption: "nope", hashtags: [], mediaIds: [] },
      ],
    });

    expect(result.targets[0].specState).not.toBe("blocked");
    expect(result.targets[1].error).toContain("channel not found");
  });
});
