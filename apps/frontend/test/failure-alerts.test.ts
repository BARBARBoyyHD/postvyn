/**
 * The alert a failed scheduled publish earns (spec: m5-publishing 7.1).
 *
 * Four promises: the platform's own error is quoted; the message names the account and links the post;
 * it offers exactly one action; and it is sent once per *terminal* failure rather than once per
 * attempt — an alert per retry trains the one person who reads these to ignore them.
 *
 * The mailer is injected, so nothing here needs a Resend key: `MemoryMailer` records what would have
 * been sent, which is the same port production uses.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { MAX_ATTEMPTS } from "@/db/jobs";
import { sendPublishFailureEmail, suggestedAction } from "@/db/alerts";
import { credentialStore } from "@/db/credentials";
import { runTick } from "@/db/tick";
import { MemoryMailer, publishFailureText } from "@/lib/email";
import type { Publisher } from "@/publishers/port";
import type { WorkerEnv } from "@/lib/env";

const testEnv: WorkerEnv = {
  DB: env.DB,
  TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  BETTER_AUTH_URL: "https://postvyn.test",
};

const WS = "ws-m5-alerts";
const BRAND = "brand-m5-alerts";
const POST = "post-m5-alerts";
const VARIANT = "var-m5-alerts";
const OWNER = "user-m5-alerts-owner";
const OWNER_EMAIL = "operator@postvyn.test";
const ACCOUNT = "x-acct-9";

const PLATFORM_ERROR = { code: "x_500", message: "Internal error" };

function stub(outcome: ReturnType<typeof failure> | ReturnType<typeof ambiguous>): Publisher {
  return {
    platform: "x",
    async preview() {
      return { calls: [], estimatedCostUsd: null, notes: [] };
    },
    async publish() {
      return outcome;
    },
    async verify(result) {
      return result;
    },
  };
}

const failure = () => ({ status: "failed" as const, platformError: PLATFORM_ERROR });
const ambiguous = () => ({ status: "uncertain" as const, detail: "socket closed after send" });

async function seed(options: { withOwner?: boolean } = {}) {
  const now = Date.now();
  const withOwner = options.withOwner ?? true;

  await env.DB.batch([
    env.DB.prepare("delete from publish_results"),
    env.DB.prepare("delete from jobs"),
    env.DB.prepare("delete from approvals"),
    env.DB.prepare("delete from variants"),
    env.DB.prepare("delete from posts"),
    env.DB.prepare("delete from channel_credentials"),
    env.DB.prepare("delete from channels"),
    env.DB.prepare("delete from memberships"),
    env.DB.prepare("delete from user"),
  ]);

  await env.DB.batch([
    env.DB.prepare(
      "insert or ignore into workspaces (id, name, plan, timezone, publishing_enabled, created_at, updated_at) values (?, 'M5 alerts', 'free', 'UTC', 1, ?, ?)",
    ).bind(WS, now, now),
    env.DB.prepare(
      "insert or ignore into brands (id, workspace_id, slug, name, created_at, updated_at) values (?, ?, 'm5-alerts', 'Alerts', ?, ?)",
    ).bind(BRAND, WS, now, now),
    env.DB.prepare(
      "insert into posts (id, workspace_id, brand_id, title, format, status, created_at, updated_at) values (?, ?, ?, 'About Zavron', 'text', 'review', ?, ?)",
    ).bind(POST, WS, BRAND, now, now),
  ]);

  // The publish path refuses an unauthenticated channel before any adapter runs (M5 §1), so the
  // failure this file is about has to happen *after* a real credential read.
  const connected = await credentialStore(testEnv).connect(
    { workspaceId: WS, userId: OWNER, role: "owner" },
    { brandId: BRAND, platform: "x", accountRef: ACCOUNT, label: "the x account", credentials: { accessToken: "test" } },
  );
  if (!connected.ok) throw new Error("seed: connect failed");

  await env.DB.prepare(
    "insert into variants (id, post_id, channel_id, caption, hashtags, media_ids, spec_state, revision, created_at, updated_at) values (?, ?, ?, 'the caption', '[\"#one\"]', '[]', 'ok', 0, ?, ?)",
  )
    .bind(VARIANT, POST, connected.channelId, now, now)
    .run();

  if (withOwner) {
    await env.DB.batch([
      env.DB.prepare("insert into user (id, name, email) values (?, 'Operator', ?)").bind(OWNER, OWNER_EMAIL),
      env.DB.prepare(
        "insert into memberships (id, user_id, workspace_id, role, created_at) values (?, ?, ?, 'owner', ?)",
      ).bind("mem-m5-alerts", OWNER, WS, now),
    ]);
  }

  const { approvals } = await import("@/db/approvals");
  const granted = await approvals(testEnv).approve(
    { workspaceId: WS, userId: OWNER, role: "owner" },
    VARIANT,
    { slotAt: now - 1_000 },
  );
  if (!granted.ok) throw new Error(`seed: approve failed (${granted.error})`);
}

/** Bring the queued job forward so the next tick runs it now. */
async function due() {
  await env.DB.prepare("update jobs set run_after = ? where state = 'queued'").bind(Date.now() - 1).run();
}

describe("a failed scheduled publish tells the operator, once", () => {
  beforeEach(async () => {
    await seed();
  });

  it("quotes the platform error, names the account, links the post and suggests one action", async () => {
    const mail = new MemoryMailer();
    const publisher = stub(failure());

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await due();
      await runTick(testEnv, { publisher, mailer: mail, maxJobs: 1 });
    }

    const job = await env.DB.prepare("select state, attempts from jobs").first<{
      state: string;
      attempts: number;
    }>();
    expect(job?.state).toBe("dead");
    expect(job?.attempts).toBe(MAX_ATTEMPTS);

    // Three attempts, one email: the retries were the queue's business.
    expect(mail.sent).toHaveLength(1);
    const first = mail.sent[0];
    expect(first.kind).toBe("publish-failure");
    if (first.kind !== "publish-failure") return;

    expect(first.to).toBe(OWNER_EMAIL);
    expect(first.platform).toBe("x");
    expect(first.account).toBe(ACCOUNT);
    expect(first.postTitle).toBe("About Zavron");
    expect(first.postUrl).toBe(`https://postvyn.test/posts/${POST}`);
    expect(first.error).toEqual(PLATFORM_ERROR);
    expect(first.action).toContain("retry");

    const text = publishFailureText(first);
    expect(text).toContain("x_500: Internal error");
    expect(text).toContain(`https://postvyn.test/posts/${POST}`);
    expect(text).toContain("What to do:");
  });

  it("treats running out of credits as money: one email, no retries, and the cost named", async () => {
    const mail = new MemoryMailer();
    const costBlocked: Publisher = {
      ...stub(failure()),
      async publish() {
        return { status: "failed", platformError: { code: "402", message: "Payment Required" } };
      },
    };

    await runTick(testEnv, { publisher: costBlocked, mailer: mail, maxJobs: 1 });

    const job = await env.DB.prepare("select state, attempts, last_error from jobs").first<{
      state: string;
      attempts: number;
      last_error: string;
    }>();
    expect(job?.state).toBe("dead");
    expect(job?.attempts).toBe(1);
    expect(job?.last_error).toContain("cost_blocked");

    expect(mail.sent).toHaveLength(1);
    const sent = mail.sent[0];
    if (sent.kind !== "publish-failure") throw new Error("expected a publish failure mail");
    expect(sent.error).toEqual({ code: "402", message: "Payment Required" });
    expect(sent.action).toContain("credits");
  });

  it("does not email an uncertain result: it needs a human, not an inbox rule", async () => {
    const mail = new MemoryMailer();
    await runTick(testEnv, { publisher: stub(ambiguous()), mailer: mail, maxJobs: 1 });

    expect(mail.sent).toEqual([]);
  });
});

describe("who is told", () => {
  it("reports a workspace with no owner row instead of quietly sending nothing", async () => {
    await seed({ withOwner: false });
    const mail = new MemoryMailer();

    const outcome = await sendPublishFailureEmail(
      testEnv,
      { variantId: VARIANT, outcome: { variantId: VARIANT, platform: "x", verdict: "failed", platformError: PLATFORM_ERROR } },
      mail,
    );

    expect(outcome).toEqual({ sent: false, reason: "no_recipient" });
    expect(mail.sent).toEqual([]);
  });
});

describe("the suggested action", () => {
  const base = { variantId: VARIANT, platform: "x" as const };

  it("maps each terminal verdict to the one thing that unblocks it", () => {
    expect(suggestedAction({ ...base, verdict: "reauth_required" })).toContain("Reconnect");
    expect(suggestedAction({ ...base, verdict: "reapproval_required" })).toContain("Approve");
    expect(suggestedAction({ ...base, verdict: "spec_blocked" })).toContain("rules");
    expect(
      suggestedAction({
        ...base,
        verdict: "failed",
        platformError: { code: "402", message: "Payment Required" },
      }),
    ).toContain("credits");
  });

  it("is one sentence, not a list of options", () => {
    const action = suggestedAction({ ...base, verdict: "failed", platformError: PLATFORM_ERROR });
    expect(action.endsWith(".")).toBe(true);
    expect(action.split(". ")).toHaveLength(1);
  });
});
