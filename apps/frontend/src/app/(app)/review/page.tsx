/**
 * Review: the queue that ends in an approval, plus what ships next.
 *
 * Approving is an owner action and it takes a slot, so this screen is deliberately not the board: the
 * board stays a read model, and a write never hides behind a checkbox on a screen somebody scrolls
 * past. Selection lives here because "approve these together at 09:00" is the batch the endpoint was
 * built for.
 */
import Link from "next/link";
import { redirect } from "next/navigation";

import { currentRequest } from "@/auth/current";
import { BulkApprove, type BulkApproveItem } from "@/components/bulk-approve";
import { DueInNextDay } from "@/components/due-in-next-day";
import { repository } from "@/db/repository";
import { dueWindow } from "@/db/tick";
import { variantHash } from "@/lib/approval";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const { env, resolved } = await currentRequest();
  if (!env || !resolved) redirect("/sign-in");
  if (!resolved.activeBrandId) redirect("/board");

  const repo = repository(env);
  const queue = await repo.listReviewQueue(resolved.ctx, { brandId: resolved.activeBrandId });
  const settings = await repo.getWorkspaceSettings(resolved.ctx);
  const due = await repo.listDueJobs(resolved.ctx, dueWindow());

  const posts = new Map(queue.posts.map((post) => [post.id, post]));
  const items: BulkApproveItem[] = await Promise.all(
    queue.variants.map(async (variant) => ({
      variantId: variant.id,
      postId: variant.postId,
      postTitle: posts.get(variant.postId)?.title ?? "untitled",
      platform: variant.platform,
      captionLength: (variant.caption ?? "").length,
      specState: variant.specState,
      // The content on screen, so an edit between render and submit becomes "re-approve", not a
      // silent approval of something the operator never saw.
      hash: await variantHash(variant),
    })),
  );

  const brand = resolved.brands?.find((item) => item.id === resolved.activeBrandId);

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
          {items.length} waiting
        </span>
      </div>

      <h1 className="mt-5 text-2xl font-medium tracking-tight text-zavron-ink">Review</h1>
      <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted">
        {brand?.name ?? "this brand"} · one slot for everything you select
      </p>

      <section className="mt-7 rounded-xl border border-zavron-line bg-zavron-bg1/30 p-5">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted">
          Waiting for approval
        </h2>

        <div className="mt-3">
          {resolved.ctx.role === "owner" ? (
            <BulkApprove items={items} />
          ) : (
            <p className="text-sm text-zavron-muted">
              {items.length === 0
                ? "Nothing waiting for approval."
                : `${items.length} variant${items.length === 1 ? "" : "s"} waiting. Only an owner can approve.`}
            </p>
          )}
        </div>
      </section>

      <DueInNextDay jobs={due} timeZone={settings?.timezone ?? "UTC"} />
    </main>
  );
}
