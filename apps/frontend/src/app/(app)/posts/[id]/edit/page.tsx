/**
 * The editor.
 *
 * Server-rendered shell, one client component per variant. The platform rules arrive as data from the
 * generated rule set, so the counter in the textarea and the verdict the server stores come from the
 * same numbers.
 */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { currentRequest } from "@/auth/current";
import { VariantEditor } from "@/components/variant-editor";
import { repository } from "@/db/repository";
import { ruleFor, type Platform } from "@/lib/specs/platforms";

export const dynamic = "force-dynamic";

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { env, resolved } = await currentRequest();
  if (!env || !resolved) redirect("/sign-in");

  const repo = repository(env);
  const detail = await repo.getPostDetail(resolved.ctx, id);
  if (!detail) notFound();

  const { post, variants } = detail;

  // The editor needs three things the detail view does not: the brand's voice note, the media library to
  // attach from, and the sibling channels a variant can be copied to.
  const [brand, media, channels] = await Promise.all([
    repo.getBrandById(resolved.ctx, post.brandId),
    repo.listMedia(resolved.ctx),
    repo.listChannels(resolved.ctx),
  ]);
  const voice = readVoice(brand?.voice ?? null);

  return (
    <main className="mx-auto max-w-4xl px-5 py-8">
      <div className="flex items-center justify-between gap-4">
        <Link
          href={`/posts/${post.id}`}
          className="font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted transition-colors hover:text-zavron-ink"
        >
          ← post
        </Link>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted">
          {post.status}
        </span>
      </div>

      <h1 className="mt-5 text-2xl font-medium leading-tight tracking-tight text-zavron-ink">
        {post.title}
      </h1>
      <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted">
        {variants.length} variant{variants.length === 1 ? "" : "s"} · edits save the verdict with the text
      </p>

      <div className="mt-7 space-y-4">
        {variants.map((variant) => {
          const rule = ruleFor(variant.platform);
          return (
            <VariantEditor
              key={variant.id}
              variantId={variant.id}
              platform={(rule?.platform ?? variant.platform) as Platform}
              channelStatus={variant.channelStatus}
              initialCaption={variant.caption ?? ""}
              initialHashtags={parseList(variant.hashtags)}
              initialMediaIds={parseList(variant.mediaIds)}
              initialRevision={variant.revision ?? 0}
              hashtagPlacement={rule?.hashtagPlacement ?? "caption"}
              voice={voice}
              media={media.map((item) => ({ id: item.id, mime: item.mime, bytes: Number(item.bytes) }))}
              otherChannels={channels
                .filter((channel) => channel.id !== variant.channelId)
                .map((channel) => ({
                  id: channel.id,
                  platform: channel.platform,
                  accountRef: channel.accountRef,
                }))}
            />
          );
        })}

        {variants.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zavron-line p-6 text-sm text-zavron-muted">
            No variants yet. Go back and add a channel to this post.
          </p>
        ) : null}
      </div>
    </main>
  );
}

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** `brand.voice` is JSON (`{tone, banned}`); the editor shows the tone, not the shape. */
function readVoice(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { tone?: unknown; banned?: unknown };
    const tone = typeof parsed.tone === "string" ? parsed.tone.trim() : "";
    const banned = Array.isArray(parsed.banned) ? parsed.banned.filter((item) => typeof item === "string") : [];
    if (!tone && banned.length === 0) return null;
    return [tone, banned.length > 0 ? `avoid: ${banned.join(", ")}` : ""].filter(Boolean).join(" · ");
  } catch {
    // A legacy row may hold a plain sentence rather than JSON.
    return raw.slice(0, 200);
  }
}
