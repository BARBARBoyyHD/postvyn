/**
 * Keeping long-lived tokens alive (platform-connections: "Tokens refresh themselves").
 *
 * Two platforms need a pass on the cron tick, for the same reason and by different mechanics:
 *
 *  - **Instagram** tokens last 60 days and can be refreshed after 24 hours.
 *  - **YouTube** refresh tokens do not expire on a schedule but die silently — revoked, left in Testing
 *    mode (7 days), a password change, or ~6 months unused. So the same monthly pass mints an access
 *    token per channel: a success keeps the channel `active`, and exercises the grant often enough that
 *    Google's unused-token invalidation never fires (design decision 2).
 *
 * A failed refresh flips the channel to `reauth_required` and writes an audit row — the operator sees it
 * on the board, and a publish that day fails as "needs re-authorisation" rather than as a mystery.
 *
 * Threads has no pass: its tokens are refreshed by the same Meta call only when the operator reconnects,
 * a gap recorded in `docs/005-REQUIREMENTS.md` rather than fixed here.
 */
import { and, eq, lte } from "drizzle-orm";

import { createDb, type Bindings } from "./client";
import { credentialStore } from "./credentials";
import * as s from "./schema";
import { INSTAGRAM_REFRESH_AFTER_MS, refreshLongLivedToken } from "@/publishers/instagram-token";
import type { Transport } from "@/publishers/transport";
import { mintAccessToken, YOUTUBE_REFRESH_AFTER_MS, youtubeCredentials } from "@/publishers/youtube-auth";
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

/**
 * The whole pass: both platforms, one report.
 *
 * Kept as one function because the cron has one slot for this work and two reports would be two things
 * to forget to read. Each platform's mechanics stay in its own function below — they change for
 * different reasons.
 */
export async function refreshTokens(
  env: WorkerEnv,
  options: TokenRefreshOptions,
): Promise<TokenRefreshReport> {
  const instagram = await refreshInstagramTokens(env, options);
  const youtube = await refreshYoutubeTokens(env, options);

  return {
    checked: instagram.checked + youtube.checked,
    refreshed: [...instagram.refreshed, ...youtube.refreshed],
    failed: [...instagram.failed, ...youtube.failed],
  };
}

export async function refreshInstagramTokens(
  env: WorkerEnv,
  options: TokenRefreshOptions,
): Promise<TokenRefreshReport> {
  const store = credentialStore(env);
  const due = await dueChannels(env, "instagram", INSTAGRAM_REFRESH_AFTER_MS, options.now ?? Date.now());
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

/**
 * YouTube's monthly exercise pass.
 *
 * "Refreshing" a refresh token is not a thing Google offers: the grant is durable and the access token
 * it mints lives about an hour. So the pass does the only useful check — mint one — and the rewrite of
 * `channel_credentials.updated_at` is what records that it happened. `invalid_grant` is the whole
 * vocabulary of a grant that died, and it takes the Instagram failure path exactly.
 */
export async function refreshYoutubeTokens(
  env: WorkerEnv,
  options: TokenRefreshOptions,
): Promise<TokenRefreshReport> {
  const store = credentialStore(env);
  const due = await dueChannels(env, "youtube", YOUTUBE_REFRESH_AFTER_MS, options.now ?? Date.now());
  const report: TokenRefreshReport = { checked: 0, refreshed: [], failed: [] };

  for (const channel of due) {
    report.checked += 1;
    const ctx = systemContext(channel.workspaceId);

    const current = await store.read(ctx, channel.id);
    if (!current.ok) {
      if (current.reason !== "key_unavailable") {
        await fail(env, channel, `credentials_${current.reason}`, options.now);
      }
      report.failed.push({ channelId: channel.id, reason: `credentials_${current.reason}` });
      continue;
    }

    const found = youtubeCredentials(current.credentials);
    if (!found.ok) {
      const reason = `credentials_missing_${found.missing.join("_")}`;
      await fail(env, channel, reason, options.now);
      report.failed.push({ channelId: channel.id, reason });
      continue;
    }

    const minted = await mintAccessToken({ credentials: found.credentials, transport: options.transport });
    if (!minted.ok) {
      const reason = `${minted.platformError.code}: ${minted.platformError.message}`;
      await fail(env, channel, reason, options.now);
      report.failed.push({ channelId: channel.id, reason });
      continue;
    }

    const written = await store.renew(ctx, channel.id, {
      ...current.credentials,
      accessToken: minted.accessToken,
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
 * Active channels of one platform whose secret has not been rewritten for the refresh interval.
 *
 * `channel_credentials.updated_at` is the age of the token: a refresh and a reconnect both rewrite it,
 * so there is no second timestamp to keep in step. Active only — refreshing a channel somebody turned
 * off would spend a platform call on a credential nobody is going to use.
 */
async function dueChannels(
  env: Bindings,
  platform: "instagram" | "youtube",
  intervalMs: number,
  now: number,
): Promise<DueChannel[]> {
  const db = createDb(env.DB);
  const cutoff = now - intervalMs;

  return db
    .select({ id: s.channels.id, workspaceId: s.brands.workspaceId })
    .from(s.channels)
    .innerJoin(s.brands, eq(s.channels.brandId, s.brands.id))
    .innerJoin(s.channelCredentials, eq(s.channelCredentials.channelId, s.channels.id))
    .where(
      and(
        eq(s.channels.platform, platform),
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
