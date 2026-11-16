/**
 * The board.
 *
 * One page, three queries (see `listBoard`) — deliberately not one query per column, because the free
 * tier's read budget is the binding constraint and a board is the most-refreshed screen in the app.
 *
 * Read-only in this milestone. Every affordance that would write is absent rather than disabled: a
 * button that exists and refuses is worse than a button that was never drawn.
 */
import Link from "next/link";
import { redirect } from "next/navigation";

import { currentRequest } from "@/auth/current";
import { repository } from "@/db/repository";

export const dynamic = "force-dynamic";

const COLUMNS = [
  { status: "idea", label: "Idea" },
  { status: "researched", label: "Researched" },
  { status: "drafting", label: "Drafting" },
  { status: "review", label: "Review" },
  { status: "approved", label: "Approved" },
  { status: "scheduled", label: "Scheduled" },
  { status: "published", label: "Published" },
  { status: "archived", label: "Archived" },
] as const;

const PLATFORMS = ["instagram", "tiktok", "x", "threads"] as const;

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ platform?: string; pillar?: string; cursor?: string; show?: string }>;
}) {
  const { env, resolved } = await currentRequest();
  if (!env || !resolved) redirect("/sign-in");

  const params = await searchParams;
  if (!resolved.activeBrandId) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-24">
        <h1 className="text-xl font-medium text-zavron-ink">No brands yet</h1>
        <p className="mt-3 text-sm leading-relaxed text-zavron-muted">
          A board belongs to a brand. Create one, or re-run the vault importer to bring over the brands
          it finds.
        </p>
      </main>
    );
  }

  const platform = PLATFORMS.includes(params.platform as (typeof PLATFORMS)[number])
    ? params.platform!
    : null;

  const board = await repository(env).listBoard(resolved.ctx, {
    brandId: resolved.activeBrandId,
    platform,
    pillar: params.pillar?.trim() || null,
    cursor: params.cursor ?? null,
    limit: 60,
  });

  const variantsByPost = new Map<string, { platform: string; specState: string; captionLength: number }[]>();
  for (const variant of board.variants) {
    const list = variantsByPost.get(variant.postId) ?? [];
    list.push({
      platform: variant.platform,
      specState: variant.specState,
      captionLength: Number(variant.captionLength),
    });
    variantsByPost.set(variant.postId, list);
  }

  const totalShown = board.posts.length;
  const activeBrand = resolved.brands?.find((brand) => brand.id === resolved.activeBrandId);
  // Published and archived are behind a toggle: they are history, and history on the same screen as
  // tomorrow's work is noise. The count is visible either way, so nothing is hidden silently.
  const showClosed = params.show === "closed";
  const closedCount = (board.counts.published ?? 0) + (board.counts.archived ?? 0);

  return (
    <main className="mx-auto max-w-[1400px] px-5 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium tracking-tight text-zavron-ink">
            {activeBrand?.name ?? "Board"}
          </h1>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted">
            {totalShown} {totalShown === 1 ? "post" : "posts"} on this page
            {board.nextCursor ? " · more below" : ""}
          </p>
        </div>

        {/* Filters are a GET form: shareable, cacheable, no client state. */}
        <form className="flex items-center gap-2" action="/board">
          <select
            name="platform"
            defaultValue={platform ?? ""}
            className="rounded-md border border-zavron-line bg-zavron-bg1/70 px-2 py-1.5 text-sm text-zavron-ink"
          >
            <option value="">all platforms</option>
            {PLATFORMS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <input
            name="pillar"
            defaultValue={params.pillar ?? ""}
            placeholder="pillar"
            className="w-32 rounded-md border border-zavron-line bg-zavron-bg1/70 px-2 py-1.5 text-sm text-zavron-ink placeholder:text-zavron-muted"
          />
          <button
            type="submit"
            className="rounded-md bg-zavron-accent px-3 py-1.5 text-sm font-medium text-zavron-bg0"
          >
            Filter
          </button>
          <Link
            href={{
              pathname: "/board",
              query: {
                ...(platform ? { platform } : {}),
                ...(params.pillar ? { pillar: params.pillar } : {}),
                ...(showClosed ? {} : { show: "closed" }),
              },
            }}
            className="rounded-md border border-zavron-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted hover:text-zavron-ink"
          >
            {showClosed ? "hide closed" : `closed (${closedCount})`}
          </Link>
        </form>
      </div>

      <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {COLUMNS.map((column) => {
          const posts = board.posts.filter((post) => post.status === column.status);
          const count = board.counts[column.status] ?? 0;
          if ((column.status === "published" || column.status === "archived") && (!showClosed || count === 0)) {
            return null;
          }

          return (
            <section key={column.status} className="min-w-0">
              <header className="mb-2 flex items-baseline justify-between border-b border-zavron-line pb-2">
                <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted">
                  {column.label}
                </h2>
                <span className="font-mono text-[11px] text-zavron-muted">{count}</span>
              </header>

              <ul className="space-y-2">
                {posts.map((post) => {
                  const variants = variantsByPost.get(post.id) ?? [];
                  return (
                    <li key={post.id}>
                      <Link
                        href={`/posts/${post.id}`}
                        className="block rounded-lg border border-zavron-line bg-zavron-bg1/50 p-3 transition-colors hover:border-brand-accent/60"
                        style={{ borderLeft: "3px solid var(--color-brand-accent)" }}
                      >
                        <p className="line-clamp-2 text-sm leading-snug text-zavron-ink">
                          {post.title}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-1">
                          {post.pillar ? (
                            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
                              {post.pillar}
                            </span>
                          ) : null}
                          {variants.map((variant) => (
                            <span
                              key={`${post.id}-${variant.platform}`}
                              className="rounded border border-zavron-line px-1 py-0.5 font-mono text-[10px] text-zavron-muted"
                              title={`${variant.captionLength} characters`}
                            >
                              {variant.platform}
                              <SpecDot state={variant.specState} />
                            </span>
                          ))}
                        </div>
                      </Link>
                    </li>
                  );
                })}

                {posts.length === 0 ? (
                  <li className="rounded-lg border border-dashed border-zavron-line/70 p-3">
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted/70">
                      empty
                    </p>
                  </li>
                ) : null}
              </ul>
            </section>
          );
        })}
      </div>

      {board.nextCursor ? (
        <div className="mt-8 flex justify-center">
          <Link
            href={{
              pathname: "/board",
              query: {
                ...(platform ? { platform } : {}),
                ...(params.pillar ? { pillar: params.pillar } : {}),
                cursor: board.nextCursor,
              },
            }}
            className="rounded-md border border-zavron-line px-4 py-2 text-sm text-zavron-ink transition-colors hover:border-zavron-accent"
          >
            Load more
          </Link>
        </div>
      ) : null}
    </main>
  );
}

/** A verdict you can read at a glance: unchecked, ok, warned, blocked. */
function SpecDot({ state }: { state: string }) {
  const color =
    state === "ok"
      ? "#5eead4"
      : state === "warn"
        ? "#fbbf24"
        : state === "blocked"
          ? "#f43f5e"
          : "#4b5563";
  return (
    <span
      aria-label={`spec ${state}`}
      className="ml-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
      style={{ background: color }}
    />
  );
}
