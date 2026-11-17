/**
 * The one email a failed scheduled publish earns.
 *
 * Per spec (m5-publishing 7.1) it carries the platform's own error, the account, a link to the post,
 * and exactly one suggested action — the operator reads it on a phone, and three options are the same
 * as none. One email per *terminal* failure, not per attempt: the retries are the queue's business
 * and telling somebody about each one trains them to ignore the alerts.
 *
 * The recipient is the workspace's owner, because that is who can reconnect a channel or top up
 * credits. A workspace with no owner row is reported rather than silently skipped — an alert nobody
 * receives is worse than no alert, because it looks like coverage.
 *
 * Sending never throws into the tick: a failed email must not leave a claimed job stuck until its
 * lease expires. The failure is a value, logged once, and the job goes on being recorded.
 */
import { and, eq } from "drizzle-orm";

import * as authSchema from "./auth-schema";
import { createDb } from "./client";
import * as s from "./schema";
import { isCostProblem } from "@/publishers/port";
import type { VariantOutcome } from "./tick";
import { mailerFrom, type Mailer } from "@/lib/email";
import type { WorkerEnv } from "@/lib/env";

export type AlertOutcome =
  | { sent: true; to: string; action: string }
  | { sent: false; reason: "not_found" | "no_recipient" | "send_failed" };

/** The app's own base, so the link opens the post rather than a route that only exists in production. */
function appUrl(env: WorkerEnv): string {
  return (env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

/**
 * The single next step, from the verdict the queue already computed.
 *
 * Deliberately a suggestion and not a diagnosis: the operator can see the post and the platform, the
 * email only has to point at the one thing that unblocks it.
 */
export function suggestedAction(outcome: VariantOutcome): string {
  // Out of credits is a spending problem, whoever reported it (X answers 402).
  if (isCostProblem(outcome)) {
    return "Top up the platform's credits, then set X_CREDITS_CONFIGURED=true so the queue may spend again.";
  }

  switch (outcome.verdict) {
    case "reauth_required":
      return "Reconnect the channel: the platform refused its credential.";
    case "not_connected":
      return "Connect or reconnect the channel: this app has no usable credential for it.";
    case "reapproval_required":
      return "Approve the post again: its content changed after it was approved.";
    case "spec_blocked":
      return "Edit the post until it satisfies the platform's rules, then approve it again.";
    case "failed":
      return "Open the post and retry once the platform is answering again.";
    case "none":
      return "Open the post: its queue record is incomplete, so nothing could be sent.";
    case "published":
    case "awaiting_platform":
    case "uncertain":
      // Not terminal failures — uncertain goes to a human through the board, not through email.
      return "Open the post: it may have shipped, so check before posting it again.";
    default: {
      const never: never = outcome.verdict;
      throw new Error(`unhandled verdict in alert: ${String(never)}`);
    }
  }
}

export async function sendPublishFailureEmail(
  env: WorkerEnv,
  input: { variantId: string; outcome: VariantOutcome },
  mailer: Mailer = mailerFrom(env),
): Promise<AlertOutcome> {
  const db = createDb(env.DB);

  const [target] = await db
    .select({
      postId: s.posts.id,
      postTitle: s.posts.title,
      workspaceId: s.posts.workspaceId,
      platform: s.channels.platform,
      accountRef: s.channels.accountRef,
    })
    .from(s.variants)
    .innerJoin(s.posts, eq(s.posts.id, s.variants.postId))
    .innerJoin(s.channels, eq(s.channels.id, s.variants.channelId))
    .where(eq(s.variants.id, input.variantId))
    .limit(1);
  if (!target) return skipped("not_found", input.variantId);

  const [owner] = await db
    .select({ email: authSchema.user.email })
    .from(s.memberships)
    .innerJoin(authSchema.user, eq(authSchema.user.id, s.memberships.userId))
    .where(and(eq(s.memberships.workspaceId, target.workspaceId), eq(s.memberships.role, "owner")))
    .orderBy(s.memberships.createdAt)
    .limit(1);
  if (!owner) return skipped("no_recipient", input.variantId);

  const action = suggestedAction(input.outcome);
  try {
    await mailer.sendPublishFailure({
      to: owner.email,
      postTitle: target.postTitle,
      platform: target.platform,
      account: target.accountRef,
      postUrl: `${appUrl(env)}/posts/${target.postId}`,
      error: input.outcome.platformError ?? null,
      action,
    });
  } catch (error) {
    console.error("[alerts] publish failure email failed", input.variantId, error);
    return { sent: false, reason: "send_failed" };
  }

  return { sent: true, to: owner.email, action };
}

/** One line, with the ids that make it findable: a skipped alert is a fact, not a footnote. */
function skipped(reason: "not_found" | "no_recipient", variantId: string): AlertOutcome {
  console.warn("[alerts] publish failure email skipped", JSON.stringify({ variantId, reason }));
  return { sent: false, reason };
}
