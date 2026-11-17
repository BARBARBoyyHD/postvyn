/**
 * Platform credentials: write them encrypted, read them back decryptable, and report what happened.
 *
 * The rule this file exists to keep (ADR-011, non-negotiable 9): a token is encrypted, never hashed,
 * because it has to be replayed to the platform. The ciphertext lives in `channel_credentials`, split
 * from `channels` so an ordinary select cannot carry it, with the channel id bound in as AAD so a dump
 * cannot transplant a row.
 *
 * Decryption happens here and nowhere near a component, a log line or a response body.
 */
import { and, eq } from "drizzle-orm";

import { createDb, type Bindings } from "./client";
import { requireCtx } from "./repository";
import * as s from "./schema";
import { decryptSecret, encryptSecret, importSecretsKey, type SecretsKey } from "@/lib/crypto";
import { requireTokenEncryptionKey, type WorkerEnv } from "@/lib/env";
import type { WorkspaceContext } from "@/lib/context";

export type StoredCredentials = Readonly<Record<string, string>>;

export type CredentialRead =
  | { ok: true; credentials: StoredCredentials; keyVersion: number }
  | { ok: false; reason: "missing" | "unreadable" | "key_unavailable"; message?: string };

export type ConnectResult =
  | { ok: true; channelId: string; created: boolean }
  | { ok: false; reason: "brand_not_found" }
  | { ok: false; reason: "key_unavailable"; message: string };

export interface CredentialRotationFailure {
  channelId: string;
  reason: string;
}

export interface CredentialRotationReport {
  /** True only when every row now decrypts under the new key. */
  ok: boolean;
  rotated: number;
  failed: CredentialRotationFailure[];
}

export function credentialStore(env: WorkerEnv) {
  const db = createDb(env.DB);

  /** Channels carry no workspace id; tenancy reaches them through their brand. */
  async function scopedChannel(ctx: WorkspaceContext, channelId: string) {
    const [row] = await db
      .select({ id: s.channels.id, status: s.channels.status })
      .from(s.channels)
      .innerJoin(s.brands, eq(s.channels.brandId, s.brands.id))
      .where(and(eq(s.channels.id, channelId), eq(s.brands.workspaceId, ctx.workspaceId)))
      .limit(1);
    return row ?? null;
  }

  async function currentKey(): Promise<SecretsKey> {
    const { base64, version } = requireTokenEncryptionKey(env);
    return importSecretsKey(base64, version);
  }

  /**
   * Encrypt and (over)write one channel's secret. Shared by connect and renew, because both write the
   * same row the same way and only one of them may touch `channels.status`.
   */
  async function writeSecret(
    channelId: string,
    credentials: Record<string, string>,
    key: SecretsKey,
  ): Promise<void> {
    const secret = await encryptSecret(JSON.stringify(credentials), channelId, key);
    const now = Date.now();

    await db
      .insert(s.channelCredentials)
      .values({
        channelId,
        ciphertext: Buffer.from(secret.ciphertext),
        iv: Buffer.from(secret.iv),
        keyVersion: secret.keyVersion,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: s.channelCredentials.channelId,
        set: {
          ciphertext: Buffer.from(secret.ciphertext),
          iv: Buffer.from(secret.iv),
          keyVersion: secret.keyVersion,
          updatedAt: now,
        },
      });
  }

  return {
    /**
     * Connect an account: create the channel if it is new, and (re)write its credentials either way.
     *
     * Reconnecting an existing channel is the same call, which is what makes `reauth_required`
     * recoverable by entering the token again rather than by deleting history.
     */
    async connect(
      ctx: WorkspaceContext,
      input: {
        brandId: string;
        platform: s.Channel["platform"];
        accountRef: string;
        label?: string | null;
        credentials: Record<string, string>;
      },
    ): Promise<ConnectResult> {
      requireCtx(ctx);

      // The key first: a channel row written without credentials would be `reauth_required` the
      // moment it appeared, and the operator would be told to reconnect what they just connected.
      let key: SecretsKey;
      try {
        key = await currentKey();
      } catch (error) {
        return {
          ok: false,
          reason: "key_unavailable",
          message: error instanceof Error ? error.message : "TOKEN_ENCRYPTION_KEY is not usable",
        };
      }

      const [brand] = await db
        .select({ id: s.brands.id })
        .from(s.brands)
        .where(and(eq(s.brands.id, input.brandId), eq(s.brands.workspaceId, ctx.workspaceId)))
        .limit(1);
      if (!brand) return { ok: false, reason: "brand_not_found" };

      const [existing] = await db
        .select({ id: s.channels.id })
        .from(s.channels)
        .where(
          and(
            eq(s.channels.brandId, input.brandId),
            eq(s.channels.platform, input.platform),
            eq(s.channels.accountRef, input.accountRef),
          ),
        )
        .limit(1);

      const now = Date.now();
      const channelId = existing?.id ?? crypto.randomUUID();

      if (existing) {
        await db
          .update(s.channels)
          .set({ label: input.label ?? null, status: "active", updatedAt: now })
          .where(eq(s.channels.id, channelId));
      } else {
        await db.insert(s.channels).values({
          id: channelId,
          brandId: input.brandId,
          platform: input.platform,
          accountRef: input.accountRef,
          label: input.label ?? null,
          status: "active",
          createdAt: now,
          updatedAt: now,
        });
      }

      await writeSecret(channelId, input.credentials, key);

      return { ok: true, channelId, created: !existing };
    },

    /**
     * Replace a channel's secret in place — a token refresh, which is not a reconnect.
     *
     * Deliberately does not touch `channels.status`: the operator's switch (or a `reauth_required`
     * flag) is not a refresh's business. Returns false when the channel is not in this workspace, so
     * the caller can report a row it could not touch instead of assuming success.
     */
    async renew(
      ctx: WorkspaceContext,
      channelId: string,
      credentials: Record<string, string>,
    ): Promise<boolean> {
      requireCtx(ctx);

      const channel = await scopedChannel(ctx, channelId);
      if (!channel) return false;

      await writeSecret(channelId, credentials, await currentKey());
      return true;
    },

    /**
     * Read a channel's credentials back.
     *
     * Every failure is the same answer to the caller — "this channel cannot publish until somebody
     * reconnects it" — with the reason kept for the log and the board. It is a value, not an
     * exception: a lost key is a recoverable operator problem, not a crash.
     */
    async read(ctx: WorkspaceContext, channelId: string): Promise<CredentialRead> {
      requireCtx(ctx);

      const channel = await scopedChannel(ctx, channelId);
      if (!channel) return { ok: false, reason: "missing" };

      const [row] = await db
        .select()
        .from(s.channelCredentials)
        .where(eq(s.channelCredentials.channelId, channelId))
        .limit(1);
      if (!row) return { ok: false, reason: "missing" };

      let key: SecretsKey;
      try {
        key = await currentKey();
      } catch (error) {
        return {
          ok: false,
          reason: "key_unavailable",
          message: error instanceof Error ? error.message : "TOKEN_ENCRYPTION_KEY is not usable",
        };
      }

      // A row from an older key needs the rotation pass before it can be read. Trying the current key
      // anyway would report every such row as tampered, which is the wrong thing to tell an operator.
      if (row.keyVersion !== key.version) {
        return {
          ok: false,
          reason: "unreadable",
          message: `row is key version ${row.keyVersion}, current is ${key.version}`,
        };
      }

      const decrypted = await decryptSecret(
        { ciphertext: row.ciphertext, iv: row.iv },
        channelId,
        key,
      );
      if (!decrypted.ok) return { ok: false, reason: "unreadable" };

      const credentials = parseCredentials(decrypted.plaintext);
      if (!credentials) return { ok: false, reason: "unreadable" };

      return { ok: true, credentials, keyVersion: row.keyVersion };
    },

    /** Disconnect: the ciphertext goes, the channel stays — its history is somebody's published work. */
    async disconnect(ctx: WorkspaceContext, channelId: string): Promise<boolean> {
      requireCtx(ctx);

      const channel = await scopedChannel(ctx, channelId);
      if (!channel) return false;

      await db.delete(s.channelCredentials).where(eq(s.channelCredentials.channelId, channelId));
      await db
        .update(s.channels)
        .set({ status: "disabled", updatedAt: Date.now() })
        .where(eq(s.channels.id, channelId));
      return true;
    },

    /**
     * The platform (or the decrypt) said this token no longer works: say so on the channel.
     *
     * `disabled` is left alone — an operator who turned a channel off should not find it switched on
     * by a failed publish attempt.
     */
    async markReauth(ctx: WorkspaceContext, channelId: string): Promise<boolean> {
      requireCtx(ctx);

      const channel = await scopedChannel(ctx, channelId);
      if (!channel || channel.status !== "active") return false;

      await db
        .update(s.channels)
        .set({ status: "reauth_required", updatedAt: Date.now() })
        .where(eq(s.channels.id, channelId));
      return true;
    },
  };
}

/**
 * Re-encrypt every credential row from one key to the next (ADR-011: a background re-encrypt, not a
 * flag day).
 *
 * No `WorkspaceContext`, deliberately: this pass neither reads nor returns plaintext and does not
 * choose a tenant — it rewrites ciphertext row by row. It is run by the operator, not by a request.
 *
 * One row's failure must not abort the pass. A row that cannot be re-encrypted is reported, so it is
 * fixed by reconnecting that channel, rather than discovered at publish time months later.
 */
export async function rotateCredentials(
  env: Bindings,
  keys: { from: SecretsKey; to: SecretsKey },
): Promise<CredentialRotationReport> {
  const db = createDb(env.DB);
  const rows = await db.select().from(s.channelCredentials);

  const failed: CredentialRotationFailure[] = [];
  let rotated = 0;

  for (const row of rows) {
    try {
      const decrypted = await decryptSecret(
        { ciphertext: row.ciphertext, iv: row.iv },
        row.channelId,
        keys.from,
      );
      if (!decrypted.ok) {
        failed.push({ channelId: row.channelId, reason: "authentication_failed" });
        continue;
      }

      const secret = await encryptSecret(decrypted.plaintext, row.channelId, keys.to);
      await db
        .update(s.channelCredentials)
        .set({
          ciphertext: Buffer.from(secret.ciphertext),
          iv: Buffer.from(secret.iv),
          keyVersion: secret.keyVersion,
          updatedAt: Date.now(),
        })
        .where(eq(s.channelCredentials.channelId, row.channelId));
      rotated += 1;
    } catch (error) {
      // Report and continue. Aborting here leaves two key versions live with no record of which row
      // is which, which is the failure mode this pass exists to avoid.
      failed.push({
        channelId: row.channelId,
        reason: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }

  return { ok: failed.length === 0, rotated, failed };
}

/** The stored payload is a JSON object of named credentials (X needs four; IG needs three). */
function parseCredentials(plaintext: string): StoredCredentials | null {
  try {
    const parsed: unknown = JSON.parse(plaintext);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    );
    return entries.length > 0 ? Object.fromEntries(entries) : null;
  } catch {
    return null;
  }
}
