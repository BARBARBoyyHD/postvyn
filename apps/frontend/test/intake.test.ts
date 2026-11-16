/**
 * Intake: what is accepted, and who may accept it.
 *
 * The file sniffing tests are table-driven because magic bytes are a table. The intake test runs the
 * real code path against real D1 and real R2 (miniflare) — the upload writes an object, so a unit test
 * with a stub bucket would prove nothing about the part that can fail.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { intake, sniff, MAX_UPLOAD_BYTES } from "@/db/intake";
import { contextForScope } from "@/lib/agent-token";
import type { WorkerEnv } from "@/lib/env";

const testEnv = env as unknown as WorkerEnv;

const WS = "ws-intake";
const BRAND = "brand-intake";
const CHANNEL = "chn-intake";
const ctx = contextForScope({
  tokenId: "tok_test",
  label: "test",
  workspaceId: WS,
  brandId: BRAND,
  role: "editor",
});

// A 1×1 PNG — real header, real CRC-optional body, enough for the sniffer and the dimension reader.
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

const MP4 = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
]);

describe("the sniffer trusts bytes, not names", () => {
  const cases: [string, Uint8Array, string | null][] = [
    ["png", PNG, "image/png"],
    ["jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"],
    ["gif", new TextEncoder().encode("GIF89a"), "image/gif"],
    ["webp", new TextEncoder().encode("RIFF....WEBP"), "image/webp"],
    ["mp4", MP4, "video/mp4"],
    ["mov", new TextEncoder().encode("\0\0\0\x18ftypqt  "), "video/quicktime"],
    ["svg", new TextEncoder().encode("<svg xmlns="), "image/svg+xml"],
    ["executable", new Uint8Array([0x4d, 0x5a, 0x90, 0x00]), null],
    ["empty", new Uint8Array([]), null],
  ];

  for (const [name, bytes, expected] of cases) {
    it(`${name} → ${expected ?? "refused"}`, () => {
      expect(sniff(bytes)?.mime ?? null).toBe(expected);
    });
  }
});

describe("uploads", () => {
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

  it("stores an object and a row, and reuses it for the same bytes", async () => {
    const first = await intake(testEnv).upload(ctx, {
      bytes: PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength),
      filename: "pixel.png",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.deduplicated).toBe(false);
    expect(first.media.mime).toBe("image/png");
    expect(first.media.width).toBe(1);

    const object = await testEnv.MEDIA!.get(first.media.key);
    expect(object).not.toBeNull();

    const second = await intake(testEnv).upload(ctx, {
      bytes: PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength),
      filename: "pixel-again.png",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.deduplicated).toBe(true);
    expect(second.media.id).toBe(first.media.id);
  });

  it("refuses an SVG by policy rather than by accident", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const result = await intake(testEnv).upload(ctx, { bytes: svg.buffer as ArrayBuffer, filename: "x.svg" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("unsupported_type");
    expect(result.message).toMatch(/SVG can carry script/);
  });

  it("refuses an empty file", async () => {
    const result = await intake(testEnv).upload(ctx, { bytes: new ArrayBuffer(0), filename: "nothing.png" });
    expect(result.ok).toBe(false);
  });

  it("names the limit when a file is too large", async () => {
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set(PNG, 0);
    const result = await intake(testEnv).upload(ctx, { bytes: big.buffer as ArrayBuffer, filename: "big.png" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("too_large");
    expect(result.message).toContain("25 MB");
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
