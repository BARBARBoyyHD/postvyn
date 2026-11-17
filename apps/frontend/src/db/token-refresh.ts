/**
 * Keeping long-lived Instagram tokens alive (platform-connections: "Tokens refresh themselves").
 *
 * Instagram tokens last 60 days and can be refreshed once they are older than 24 hours. There is no
 * platform push, so the only way this happens is a pass on the cron tick: a refresh that silently
 * stops running is a channel that dies in two months, which is exactly the failure the spec forbids.
 *
 * A failed refresh flips the channel to `reauth_required` and writes an audit row — the operator sees
 * it on the board, and a publish that day fails as "needs re-authorisation" rather than as a mystery.
 */
import { and, eq, lte } from "drizzle-orm";

import { createDb, type Bindings } from "./client";
import { credentialStore } from "./credentials";
import * as s from "./schema";
import { INSTAGRAM_REFRESH_AFTER_MS, refreshLongLivedToken } from "@/publishers/instagram-token";
import type { Transport } from "@/publishers/transport";
import { systemContext } from "@/lib/context";
import type { WorkerEnv } from "@/lib/env";

export interface TokenRefreshReport {
  /** Channels that were old enough to refresh and were looked at. */
  checked: number;
  refreshed: string[];
  failed: { channelId: string; reason: string }[];
}

export interface TokenRefreshOptions {
  transport: Transport;
  now?: number;
}

export async function refreshInstagramTokens(
  env: WorkerEnv,
  options: TokenRefreshOptions,
): Promise<TokenRefreshReport> {
  const store = credentialStore(env);
  const due = await dueChannels(env, options.now ?? Date.now());
  const report: TokenRefreshReport = { checked: 0, refreshed: [], failed: [] };

  for (const channel of due) {
    report.checked += 1;
    const ctx = systemContext(channel.workspaceId);

    const current = await store.read(ctx, channel.id);
    if (!current.ok) {
      // A missing key is a deployment problem, not this account's: report it, but leave the channel
      // alone — flipping every Instagram channel to `reauth_required` would send the operator to
      // reconnect accounts whose tokens are fine. An unreadable *row* is a real re-auth need.
      if (current.reason !== "key_unavailable") {
        await fail(env, channel, `credentials_${current.reason}`, options.now);
      }
      report.failed.push({ channelId: channel.id, reason: `credentials_${current.reason}` });
      continue;
    }

    const accessToken = current.credentials.accessToken;
    if (!accessToken) {
      await fail(env, channel, "credentials_missing_accessToken", options.now);
      report.failed.push({ channelId: channel.id, reason: "credentials_missing_accessToken" });
      continue;
    }

    const refreshed = await refreshLongLivedToken({ accessToken, transport: options.transport });

    if (!refreshed.ok) {
      const reason = `${refreshed.platformError.code}: ${refreshed.platformError.message}`;
      await fail(env, channel, reason, options.now);
      report.failed.push({ channelId: channel.id, reason });
      continue;
    }

    const written = await store.renew(ctx, channel.id, {
      ...current.credentials,
      accessToken: refreshed.accessToken,
    });
    if (!written) {
      report.failed.push({ channelId: channel.id, reason: "channel_left_the_workspace" });
      continue;
    }
    report.refreshed.push(channel.id);
  }

  return report;
}

interface DueChannel {
  id: string;
  workspaceId: string;
}

/**
 * Active Instagram channels whose secret has not been rewritten for the refresh interval.
 *
 * `channel_credentials.updated_at` is the age of the token: a refresh and a reconnect both rewrite it,
 * so there is no second timestamp to keep in step. Active only — refreshing a channel somebody turned
 * off would spend a platform call on a credential nobody is going to use.
 */
async function dueChannels(env: Bindings, now: number): Promise<DueChannel[]> {
  const db = createDb(env.DB);
  const cutoff = now - INSTAGRAM_REFRESH_AFTER_MS;

  return db
    .select({ id: s.channels.id, workspaceId: s.brands.workspaceId })
    .from(s.channels)
    .innerJoin(s.brands, eq(s.channels.brandId, s.brands.id))
    .innerJoin(s.channelCredentials, eq(s.channelCredentials.channelId, s.channels.id))
    .where(
      and(
        eq(s.channels.platform, "instagram"),
        eq(s.channels.status, "active"),
        lte(s.channelCredentials.updatedAt, cutoff),
      ),
    );
}

/** A refresh that could not happen is a channel a human has to reconnect: say so where the board reads. */
async function fail(
  env: WorkerEnv,
  channel: DueChannel,
  reason: string,
  now = Date.now(),
): Promise<void> {
  const db = createDb(env.DB);
  const ctx = systemContext(channel.workspaceId);

  await credentialStore(env).markReauth(ctx, channel.id);
  await db.insert(s.activityLog).values({
    id: `act_${crypto.randomUUID().slice(0, 8)}`,
    workspaceId: channel.workspaceId,
    postId: null,
    actorId: null,
    action: "channel.token_refresh_failed",
    detail: JSON.stringify({ channelId: channel.id, reason }),
    createdAt: now,
  });
}
