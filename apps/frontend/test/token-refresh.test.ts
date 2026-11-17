/**
 * The monthly Instagram token refresh (platform-connections: "Tokens refresh themselves").
 *
 * Two promises: a token old enough is replaced and the channel stays active, and a refresh the platform
 * refuses is visible — the channel moves to reauth_required and an audit row says why. The age is
 * simulated by moving the clock forward instead of backdating rows, because the interval is the thing
 * under test.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { credentialStore } from "@/db/credentials";
import { refreshInstagramTokens } from "@/db/token-refresh";
import { INSTAGRAM_REFRESH_AFTER_MS } from "@/publishers/instagram-token";
import type { WorkspaceContext } from "@/lib/context";
import type { WorkerEnv } from "@/lib/env";
import { fixtureTransport } from "./support/fixture-transport";

import refreshOk from "./fixtures/instagram/token-refresh.json";
import refreshFailed from "./fixtures/instagram/token-refresh-failed.json";

const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const testEnv: WorkerEnv = { DB: env.DB, TOKEN_ENCRYPTION_KEY: KEY };

const WS = "ws-token-refresh";
const USER = "user-refresh";
const BRAND = "brand-refresh";
const ACCOUNT_REF = "17841400000000099";

const ctx: WorkspaceContext = { workspaceId: WS, userId: USER, role: "owner" };

let channelId = "";

async function seed() {
  const now = Date.now();

  await env.DB.batch([
    env.DB.prepare("delete from channel_credentials"),
    env.DB.prepare("delete from channels"),
    env.DB.prepare(
      "insert or ignore into workspaces (id, name, plan, timezone, publishing_enabled, created_at, updated_at) values (?, 'Token refresh', 'free', 'UTC', 1, ?, ?)",
    ).bind(WS, now, now),
    env.DB.prepare(
      "insert or ignore into brands (id, workspace_id, slug, name, created_at, updated_at) values (?, ?, 'token-refresh', 'Refresh', ?, ?)",
    ).bind(BRAND, WS, now, now),
  ]);

  const connected = await credentialStore(testEnv).connect(ctx, {
    brandId: BRAND,
    platform: "instagram",
    accountRef: ACCOUNT_REF,
    credentials: { accessToken: "old-token" },
  });
  if (!connected.ok) throw new Error("seed: connect failed");
  channelId = connected.channelId;
}

const MONTH = INSTAGRAM_REFRESH_AFTER_MS;

describe("the Instagram token refresh", () => {
  beforeEach(seed);

  it("does nothing to a token that is younger than the interval", async () => {
    const recorded = fixtureTransport(refreshOk);
    const report = await refreshInstagramTokens(testEnv, {
      transport: recorded.transport,
      now: Date.now(),
    });

    expect(report).toEqual({ checked: 0, refreshed: [], failed: [] });
    expect(recorded.calls).toEqual([]);
  });

  it("replaces a token that is a month old, and the channel stays active", async () => {
    const recorded = fixtureTransport(refreshOk);
    const report = await refreshInstagramTokens(testEnv, {
      transport: recorded.transport,
      now: Date.now() + MONTH,
    });

    expect(report.refreshed).toEqual([channelId]);
    expect(recorded.calls[0].url).toContain("grant_type=ig_refresh_token");

    const stored = await credentialStore(testEnv).read(ctx, channelId);
    expect(stored.ok).toBe(true);
    if (stored.ok) expect(stored.credentials.accessToken).toBe("IGQVJY-refreshed-token");

    const channel = await env.DB.prepare("select status from channels where id = ?")
      .bind(channelId)
      .first<{ status: string }>();
    expect(channel?.status).toBe("active");
  });

  it("a refused refresh asks for a human, and says which account", async () => {
    const recorded = fixtureTransport(refreshFailed);
    const report = await refreshInstagramTokens(testEnv, {
      transport: recorded.transport,
      now: Date.now() + MONTH,
    });

    expect(report.failed[0]?.channelId).toBe(channelId);
    expect(report.failed[0]?.reason).toContain("190");

    const channel = await env.DB.prepare("select status from channels where id = ?")
      .bind(channelId)
      .first<{ status: string }>();
    expect(channel?.status).toBe("reauth_required");

    const audit = await env.DB.prepare(
      "select workspace_id, detail from activity_log where action = 'channel.token_refresh_failed'",
    ).first<{ workspace_id: string; detail: string }>();
    expect(audit?.workspace_id).toBe(WS);
    expect(JSON.parse(audit?.detail ?? "{}")).toMatchObject({ channelId });
  });
});
