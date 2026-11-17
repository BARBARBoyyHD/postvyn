/**
 * Credentials at rest: encrypted, bound to their channel, and never handed back as text.
 *
 * Runs against real D1 in `workerd`, so what is proven is the rows that actually land — including that
 * `channels` joined the way the read model joins it reports an unconnected channel as
 * `reauth_required` rather than `active`.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { credentialStore, rotateCredentials } from "@/db/credentials";
import { repository } from "@/db/repository";
import { importSecretsKey } from "@/lib/crypto";
import type { WorkerEnv } from "@/lib/env";
import type { WorkspaceContext } from "@/lib/context";

const KEY_1 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const KEY_2 = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";

const envV1: WorkerEnv = {
  DB: env.DB,
  TOKEN_ENCRYPTION_KEY: KEY_1,
  TOKEN_ENCRYPTION_KEY_VERSION: "1",
};

const envV2: WorkerEnv = {
  DB: env.DB,
  TOKEN_ENCRYPTION_KEY: KEY_2,
  TOKEN_ENCRYPTION_KEY_VERSION: "2",
};

const WS_A = "33333333-3333-4333-8333-333333333333";
const WS_B = "44444444-4444-4444-8444-444444444444";
const BRAND_A = "aaaaaaaa-3333-4333-8333-000000000001";
const BRAND_B = "bbbbbbbb-4444-4444-8444-000000000002";

const ctxA: WorkspaceContext = { workspaceId: WS_A, userId: "user-a", role: "owner" };
const ctxB: WorkspaceContext = { workspaceId: WS_B, userId: "user-b", role: "owner" };

const TOKEN = "ig-secret-token-value";

const repo = repository({ DB: env.DB });

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("delete from channel_credentials"),
    env.DB.prepare("delete from channels"),
    env.DB.prepare("delete from brands"),
    env.DB.prepare("delete from workspaces"),
  ]);

  await env.DB.batch([
    env.DB.prepare("insert into workspaces (id, name) values (?, ?)").bind(WS_A, "Cred A"),
    env.DB.prepare("insert into workspaces (id, name) values (?, ?)").bind(WS_B, "Cred B"),
    env.DB.prepare("insert into brands (id, workspace_id, slug, name) values (?, ?, ?, ?)").bind(
      BRAND_A,
      WS_A,
      "cred-a",
      "Cred A",
    ),
    env.DB.prepare("insert into brands (id, workspace_id, slug, name) values (?, ?, ?, ?)").bind(
      BRAND_B,
      WS_B,
      "cred-b",
      "Cred B",
    ),
  ]);
});

describe("connecting an account", () => {
  it("stores ciphertext, and reading it back returns the credentials", async () => {
    const store = credentialStore(envV1);
    const connected = await store.connect(ctxA, {
      brandId: BRAND_A,
      platform: "instagram",
      accountRef: "17841400000000000",
      label: "brand a ig",
      credentials: { accessToken: TOKEN, igUserId: "17841400000000000" },
    });
    expect(connected.ok).toBe(true);
    if (!connected.ok) throw new Error("connect failed");

    const row = await env.DB.prepare(
      "select ciphertext, key_version from channel_credentials where channel_id = ?",
    )
      .bind(connected.channelId)
      .first<{ ciphertext: ArrayBuffer; key_version: number }>();

    expect(row?.key_version).toBe(1);
    expect(Buffer.from(row!.ciphertext).toString("utf8")).not.toContain(TOKEN);

    const read = await store.read(ctxA, connected.channelId);
    expect(read).toEqual({
      ok: true,
      credentials: { accessToken: TOKEN, igUserId: "17841400000000000" },
      keyVersion: 1,
    });
  });

  it("a row copied to another channel id does not decrypt", async () => {
    const store = credentialStore(envV1);
    const first = await store.connect(ctxA, {
      brandId: BRAND_A,
      platform: "instagram",
      accountRef: "ig-1",
      credentials: { accessToken: TOKEN },
    });
    if (!first.ok) throw new Error("connect failed");

    const [other] = await repo.listChannels(ctxA);
    const second = await store.connect(ctxA, {
      brandId: BRAND_A,
      platform: "threads",
      accountRef: "th-1",
      credentials: { accessToken: "threads-token" },
    });
    if (!second.ok) throw new Error("connect failed");
    expect(other.id).not.toBe(second.channelId);

    // The transplant a dump makes easy: point B's row at A's ciphertext.
    await env.DB.prepare(
      "update channel_credentials set ciphertext = (select ciphertext from channel_credentials where channel_id = ?), iv = (select iv from channel_credentials where channel_id = ?) where channel_id = ?",
    )
      .bind(first.channelId, first.channelId, second.channelId)
      .run();

    const read = await store.read(ctxA, second.channelId);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.reason).toBe("unreadable");
  });

  it("reconnecting the same account keeps the channel and replaces the secret", async () => {
    const store = credentialStore(envV1);
    const first = await store.connect(ctxA, {
      brandId: BRAND_A,
      platform: "threads",
      accountRef: "x-1",
      credentials: { accessToken: "old" },
    });
    const second = await store.connect(ctxA, {
      brandId: BRAND_A,
      platform: "threads",
      accountRef: "x-1",
      credentials: { accessToken: "new" },
    });
    if (!first.ok || !second.ok) throw new Error("connect failed");

    expect(second.created).toBe(false);
    expect(second.channelId).toBe(first.channelId);

    const read = await store.read(ctxA, first.channelId);
    expect(read.ok && read.credentials.accessToken).toBe("new");
  });

  it("refuses a brand from another workspace", async () => {
    const store = credentialStore(envV1);
    const result = await store.connect(ctxA, {
      brandId: BRAND_B,
      platform: "instagram",
      accountRef: "ig-b",
      credentials: { accessToken: TOKEN },
    });
    expect(result).toEqual({ ok: false, reason: "brand_not_found" });
  });
});

describe("tenancy reaches credentials through the channel's brand", () => {
  it("another workspace's channel reads as missing, not as forbidden", async () => {
    const store = credentialStore(envV1);
    const connected = await store.connect(ctxA, {
      brandId: BRAND_A,
      platform: "instagram",
      accountRef: "ig-1",
      credentials: { accessToken: TOKEN },
    });
    if (!connected.ok) throw new Error("connect failed");

    expect(await store.read(ctxB, connected.channelId)).toEqual({ ok: false, reason: "missing" });
    expect(await store.disconnect(ctxB, connected.channelId)).toBe(false);
  });
});

describe("disconnecting", () => {
  it("removes the ciphertext and disables the channel without deleting its history", async () => {
    const store = credentialStore(envV1);
    const connected = await store.connect(ctxA, {
      brandId: BRAND_A,
      platform: "threads",
      accountRef: "th-1",
      credentials: { accessToken: TOKEN },
    });
    if (!connected.ok) throw new Error("connect failed");

    expect(await store.disconnect(ctxA, connected.channelId)).toBe(true);

    const row = await env.DB.prepare("select count(*) as n from channel_credentials where channel_id = ?")
      .bind(connected.channelId)
      .first<{ n: number }>();
    expect(Number(row?.n)).toBe(0);

    const [channel] = await repo.listChannels(ctxA);
    expect(channel.status).toBe("disabled");
  });
});

describe("channel state follows credential health", () => {
  it("an imported channel with no credentials is reauth_required, not active", async () => {
    await env.DB.prepare(
      "insert into channels (id, brand_id, platform, account_ref, status) values (?, ?, 'instagram', 'imported', 'active')",
    )
      .bind("chn-imported", BRAND_A)
      .run();

    const [channel] = await repo.listChannels(ctxA);
    expect(channel.status).toBe("reauth_required");
  });

  it("is active once connected, and stays disabled after a deliberate disconnect", async () => {
    const store = credentialStore(envV1);
    const connected = await store.connect(ctxA, {
      brandId: BRAND_A,
      platform: "instagram",
      accountRef: "ig-1",
      credentials: { accessToken: TOKEN },
    });
    if (!connected.ok) throw new Error("connect failed");

    expect((await repo.listChannels(ctxA))[0].status).toBe("active");

    await store.disconnect(ctxA, connected.channelId);
    expect((await repo.listChannels(ctxA))[0].status).toBe("disabled");
  });

  it("markReauth flips an active channel and leaves a disabled one alone", async () => {
    const store = credentialStore(envV1);
    const connected = await store.connect(ctxA, {
      brandId: BRAND_A,
      platform: "instagram",
      accountRef: "ig-1",
      credentials: { accessToken: TOKEN },
    });
    if (!connected.ok) throw new Error("connect failed");

    expect(await store.markReauth(ctxA, connected.channelId)).toBe(true);
    expect((await repo.listChannels(ctxA))[0].status).toBe("reauth_required");

    await env.DB.prepare("update channels set status = 'disabled' where id = ?")
      .bind(connected.channelId)
      .run();
    expect(await store.markReauth(ctxA, connected.channelId)).toBe(false);
  });
});

describe("no endpoint shape carries a secret", () => {
  it("the connect answer and the channel list contain neither token nor ciphertext", async () => {
    const store = credentialStore(envV1);
    const connected = await store.connect(ctxA, {
      brandId: BRAND_A,
      platform: "instagram",
      accountRef: "ig-1",
      credentials: { accessToken: TOKEN },
    });
    if (!connected.ok) throw new Error("connect failed");

    const row = await env.DB.prepare(
      "select ciphertext from channel_credentials where channel_id = ?",
    )
      .bind(connected.channelId)
      .first<{ ciphertext: ArrayBuffer }>();
    const ciphertext = Buffer.from(row!.ciphertext).toString("base64");

    const responses = [
      JSON.stringify(connected),
      JSON.stringify({ channels: await repo.listChannels(ctxA) }),
      JSON.stringify(await repo.getChannelById(ctxA, connected.channelId)),
    ];

    for (const body of responses) {
      expect(body).not.toContain(TOKEN);
      expect(body).not.toContain(ciphertext);
      expect(body).not.toContain("ciphertext");
      expect(body).not.toContain("accessToken");
    }
  });
});

describe("rotation is a recorded pass, not a replace", () => {
  it("re-encrypts every readable row and bumps the key version", async () => {
    const store = credentialStore(envV1);
    const first = await store.connect(ctxA, {
      brandId: BRAND_A,
      platform: "instagram",
      accountRef: "ig-1",
      credentials: { accessToken: TOKEN },
    });
    const second = await store.connect(ctxA, {
      brandId: BRAND_A,
      platform: "threads",
      accountRef: "th-1",
      credentials: { accessToken: "threads-token" },
    });
    if (!first.ok || !second.ok) throw new Error("connect failed");

    const report = await rotateCredentials({ DB: env.DB }, {
      from: await importSecretsKey(KEY_1, 1),
      to: await importSecretsKey(KEY_2, 2),
    });

    expect(report).toEqual({ ok: true, rotated: 2, failed: [] });

    const versions = await env.DB.prepare("select distinct key_version from channel_credentials").all<{
      key_version: number;
    }>();
    expect(versions.results.map((row) => row.key_version)).toEqual([2]);

    const readUnderNewKey = await credentialStore(envV2).read(ctxA, first.channelId);
    expect(readUnderNewKey.ok && readUnderNewKey.credentials.accessToken).toBe(TOKEN);
  });

  it("reports the row it could not re-encrypt and still rotates the rest", async () => {
    const store = credentialStore(envV1);
    const good = await store.connect(ctxA, {
      brandId: BRAND_A,
      platform: "instagram",
      accountRef: "ig-1",
      credentials: { accessToken: TOKEN },
    });
    const broken = await store.connect(ctxA, {
      brandId: BRAND_A,
      platform: "threads",
      accountRef: "th-1",
      credentials: { accessToken: "threads-token" },
    });
    if (!good.ok || !broken.ok) throw new Error("connect failed");

    // A row that no key can read: the case rotation exists to surface rather than bury.
    await env.DB.prepare("update channel_credentials set ciphertext = ? where channel_id = ?")
      .bind(Buffer.from("not-a-ciphertext"), broken.channelId)
      .run();

    const report = await rotateCredentials({ DB: env.DB }, {
      from: await importSecretsKey(KEY_1, 1),
      to: await importSecretsKey(KEY_2, 2),
    });

    expect(report.ok).toBe(false);
    expect(report.rotated).toBe(1);
    expect(report.failed).toEqual([{ channelId: broken.channelId, reason: "authentication_failed" }]);

    const stillReadable = await credentialStore(envV2).read(ctxA, good.channelId);
    expect(stillReadable.ok).toBe(true);
  });
});
