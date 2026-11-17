/**
 * Post detail.
 *
 * The place where "was this approved, and is it still what was approved" becomes visible. In this
 * milestone there is no approval yet, so the panel says `unchecked` / `not approved` in words rather
 * than showing an empty state that looks like a bug.
 */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { currentRequest } from "@/auth/current";
import { ApproveControl } from "@/components/approve-control";
import { PublishNowButton } from "@/components/publish-now-button";
import { TiktokPack } from "@/components/tiktok-pack";
import { repository } from "@/db/repository";
import { costLabel } from "@/lib/cost";
import { formatAttemptDuration } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { env, resolved } = await currentRequest();
  if (!env || !resolved) redirect("/sign-in");

  const detail = await repository(env).getPostDetail(resolved.ctx, id);
  // A post in another workspace is not "forbidden" — it does not exist here.
  if (!detail) notFound();

  const { post, variants, media, activity, attempts, publishResults } = detail;
  const mediaById = new Map(media.map((row) => [row.id, row]));
  const platformByVariant = new Map(variants.map((variant) => [variant.id, variant.platform]));

  // The upload button names every destination it is about to send to: the confirmation is compared
  // against each variant's channel, so a wrong channel is a refusal rather than a surprise.
  const channelsById = new Map(
    (await repository(env).listChannels(resolved.ctx)).map((channel) => [channel.id, channel]),
  );
  const publishTargets = variants.flatMap((variant) => {
    const channel = channelsById.get(variant.channelId);
    return channel
      ? [{ variantId: variant.id, platform: channel.platform, account: channel.accountRef }]
      : [];
  });

  // `uncertain` is not a state to badge: the platform may have accepted the post. It goes above the
  // fold, in words, before any control that might send it again.
  const uncertainPlatforms = [
    ...new Set(
      publishResults.filter((result) => result.state === "uncertain").map((result) => result.platform),
    ),
  ];

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/board"
          className="font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted transition-colors hover:text-zavron-ink"
        >
          ← board
        </Link>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted">
          {post.status}
        </span>
      </div>

      <h1 className="mt-5 text-2xl font-medium leading-tight tracking-tight text-zavron-ink">
        {post.title}
      </h1>

      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 font-mono text-[11px] uppercase tracking-[0.14em] text-zavron-muted">
        {post.format ? <Meta label="format" value={post.format} /> : null}
        {post.pillar ? <Meta label="pillar" value={post.pillar} /> : null}
        <Meta label="variants" value={String(variants.length)} />
        <Meta label="media" value={String(media.length)} />
        {post.scheduleAt ? (
          <Meta label="slot" value={new Date(post.scheduleAt).toISOString().slice(0, 16).replace("T", " ")} />
        ) : null}
      </dl>

      {uncertainPlatforms.length > 0 ? (
        <section
          role="alert"
          className="mt-6 rounded-xl border border-[#fbbf24]/50 bg-[#fbbf24]/5 px-4 py-3"
        >
          <h2 className="text-sm font-medium text-zavron-ink">Publish result unknown</h2>
          <p className="mt-1 text-sm leading-relaxed text-zavron-muted">
            The platform may have accepted this. Check the account before retrying.
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[#fbbf24]">
            affected: {uncertainPlatforms.join(", ")}
          </p>
        </section>
      ) : null}

      {resolved.ctx.role === "owner" ? (
        <div className="mt-6">
          <PublishNowButton
            postId={post.id}
            targets={publishTargets}
            disabled={post.status === "published"}
          />
        </div>
      ) : null}

      <div className="mt-8 space-y-4">
        {variants.map((variant) => {
          const hashtags = parseList(variant.hashtags);
          const mediaIds = parseList(variant.mediaIds);
          const caption = variant.caption ?? "";

          return (
            <section key={variant.id} className="rounded-xl border border-zavron-line bg-zavron-bg1/40">
              <header className="flex flex-wrap items-center gap-3 border-b border-zavron-line px-4 py-3">
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-brand-accent">
                  {variant.platform}
                </span>
                <span
                  className={`font-mono text-[10px] uppercase tracking-[0.14em] ${
                    variant.channelStatus === "reauth_required"
                      ? "text-[#fbbf24]"
                      : "text-zavron-muted"
                  }`}
                >
                  {variant.channelStatus === "reauth_required"
                    ? "reconnect required"
                    : variant.channelStatus}
                </span>
                <span className="ml-auto flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
                  <span>{caption.length} chars</span>
                  <span>{hashtags.length} tags</span>
                  <span>{mediaIds.length} media</span>
                  <SpecBadge state={variant.specState} version={variant.specVersion} />
                </span>
              </header>

              <div className="px-4 py-4">
                {variant.note ? (
                  <p className="mb-3 font-mono text-[10px] leading-relaxed text-zavron-muted/80">
                    {variant.note}
                  </p>
                ) : null}

                <p className="whitespace-pre-wrap text-sm leading-relaxed text-zavron-ink">
                  {caption || <span className="text-zavron-muted">empty caption</span>}
                </p>

                {hashtags.length > 0 ? (
                  <p className="mt-3 font-mono text-xs leading-relaxed text-zavron-muted">
                    {hashtags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).join(" ")}
                  </p>
                ) : null}

                {mediaIds.length > 0 ? (
                  <ol className="mt-4 space-y-1">
                    {mediaIds.map((mediaId, index) => {
                      const row = mediaById.get(mediaId);
                      return (
                        <li
                          key={`${variant.id}-${mediaId}`}
                          className="flex items-center gap-3 rounded border border-zavron-line/60 px-2 py-1 font-mono text-[10px] text-zavron-muted"
                        >
                          <span className="text-zavron-ink">{index + 1}</span>
                          <span className="truncate">{row?.key ?? mediaId}</span>
                          <span className="ml-auto shrink-0">
                            {row ? `${row.mime.replace("image/", "")} · ${formatBytes(row.bytes)}` : "missing"}
                          </span>
                          {row && !row.postable ? (
                            <span className="shrink-0 rounded border border-zavron-line px-1 text-[9px] uppercase tracking-[0.14em]">
                              ref only
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                ) : null}

                {resolved.ctx.role === "owner" ? (
                  <ApproveControl
                    variantId={variant.id}
                    status={post.status}
                    slotAt={post.scheduleAt ?? null}
                  />
                ) : null}

                {variant.platform === "tiktok" ? (
                  <TiktokPack
                    variantId={variant.id}
                    canComplete={resolved.ctx.role === "owner"}
                    published={post.status === "published"}
                  />
                ) : null}
              </div>
            </section>
          );
        })}

        {variants.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zavron-line p-6 text-sm text-zavron-muted">
            This post has no variants. A post publishes one variant per channel.
          </p>
        ) : null}
      </div>

      <section className="mt-10">
        <h2 className="border-b border-zavron-line pb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted">
          History
        </h2>

        {attempts.length > 0 ? (
          <div className="mt-4">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
              Attempts
            </h3>
            <ol className="mt-2 space-y-1">
              {attempts.map((job) => {
                const duration = formatAttemptDuration(
                  job.attemptStartedAt,
                  job.attemptFinishedAt,
                );
                return (
                  <li key={job.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                    <span className="text-zavron-ink">
                      {platformByVariant.get(job.variantId) ?? "variant"}
                    </span>
                    <span className="font-mono text-[10px] text-zavron-muted">
                      attempt {job.attempts}
                      {duration ? ` · ${duration}` : ""}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
                      {job.state.replace(/_/g, " ")}
                    </span>
                    {job.lastError ? (
                      <span className="font-mono text-[10px] text-zavron-muted/70">
                        {job.lastError}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}

        {publishResults.length > 0 ? (
          <div className="mt-4">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
              Results
            </h3>
            <ol className="mt-2 space-y-1">
              {publishResults.map((result) => {
                const cost = costLabel(result.platform, result.estimatedCostUsd);
                return (
                  <li key={result.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                    <span className="text-zavron-ink">{result.platform}</span>
                    <span
                      className={`font-mono text-[10px] uppercase tracking-[0.14em] ${resultColor(result.state)}`}
                    >
                      {result.state}
                    </span>
                    {result.url ? (
                      <a
                        href={result.url}
                        className="font-mono text-[10px] text-zavron-muted underline decoration-zavron-line underline-offset-2 hover:text-zavron-ink"
                      >
                        open
                      </a>
                    ) : null}
                    {cost ? (
                      <span className="font-mono text-[10px] text-zavron-ink">{cost}</span>
                    ) : null}
                    <time className="ml-auto font-mono text-[10px] text-zavron-muted/70">
                      {new Date(result.createdAt).toISOString().slice(0, 16).replace("T", " ")}
                    </time>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}

        {activity.length === 0 ? (
          <p className="mt-3 text-sm text-zavron-muted">Nothing recorded yet.</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {activity.map((entry) => {
              const reauth = entry.action === "channel.reauth_required";
              const quotaBlocked = entry.action === "publish.quota_blocked";
              const detail = activityDetail(entry.action, entry.detail);
              return (
                <li key={entry.id} className="flex flex-wrap items-baseline gap-3 text-sm">
                  <time className="font-mono text-[10px] text-zavron-muted">
                    {new Date(entry.createdAt).toISOString().slice(0, 16).replace("T", " ")}
                  </time>
                  <span className={reauth ? "text-[#fbbf24]" : "text-zavron-ink"}>
                    {reauth ? "reconnect required" : entry.action.replace(/_/g, " ")}
                  </span>
                  {detail ? (
                    <span
                      className={`font-mono text-[10px] ${
                        reauth || quotaBlocked ? "text-[#fbbf24]" : "text-zavron-muted"
                      }`}
                    >
                      {detail}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <p className="mt-10 font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted/70">
        approval is bound to content · a 200 is not success until the platform is read back
      </p>
    </main>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt>{label}</dt>
      <dd className="text-zavron-ink">{value}</dd>
    </div>
  );
}

function SpecBadge({ state, version }: { state: string; version: string | null }) {
  const copy =
    state === "unchecked"
      ? "not checked"
      : state === "ok"
        ? "within spec"
        : state === "warn"
          ? "warnings"
          : state === "blocked"
            ? "blocked"
            : state;
  return (
    <span title={version ? `checked against ${version}` : "never checked"}>
      spec: {copy}
    </span>
  );
}

/** A read-back verdict: teal shipped, amber needs a human, rose failed before the platform. */
function resultColor(state: string): string {
  switch (state) {
    case "succeeded":
      return "text-[#5eead4]";
    case "uncertain":
      return "text-[#fbbf24]";
    case "failed":
      return "text-[#f43f5e]";
    default:
      return "text-zavron-muted";
  }
}

/**
 * The activity log stores every detail as JSON text. Two actions carry something an operator can act
 * on — an exhausted quota and a credential that expired — so they get words instead of a blob.
 */
function activityDetail(action: string, raw: string | null): string | null {
  if (!raw) return null;
  if (action !== "publish.quota_blocked" && action !== "channel.reauth_required") return raw;

  try {
    const detail = JSON.parse(raw) as {
      platformError?: { code?: unknown; message?: unknown };
    };
    const parts: string[] = [];
    if (typeof detail.platformError?.message === "string") {
      parts.push(`${String(detail.platformError.code ?? "error")}: ${detail.platformError.message}`);
    }
    return parts.length > 0 ? parts.join(" · ") : null;
  } catch {
    return raw;
  }
}

/** `hashtags` and `media_ids` are JSON text in D1; a corrupt value reads as empty, never as a crash. */
function parseList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
