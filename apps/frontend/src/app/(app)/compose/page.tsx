/**
 * Compose.
 *
 * One screen: what the post is, and which channels it goes to. Captions come next, in the editor,
 * because writing four variants at once before seeing the rules is how people write four captions that
 * all fail the same way.
 */
import Link from "next/link";
import { redirect } from "next/navigation";

import { currentRequest } from "@/auth/current";
import { ComposeForm } from "@/components/compose-form";
import { repository } from "@/db/repository";

export const dynamic = "force-dynamic";

export default async function ComposePage() {
  const { env, resolved } = await currentRequest();
  if (!env || !resolved) redirect("/sign-in");
  if (!resolved.activeBrandId) redirect("/board");

  const channels = (await repository(env).listChannels(resolved.ctx)).filter(
    (channel) => channel.brandId === resolved.activeBrandId,
  );

  const brand = resolved.brands?.find((item) => item.id === resolved.activeBrandId);

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link
        href="/board"
        className="font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted transition-colors hover:text-zavron-ink"
      >
        ← board
      </Link>

      <h1 className="mt-5 text-2xl font-medium tracking-tight text-zavron-ink">Compose</h1>
      <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted">
        new post for {brand?.name ?? "this brand"}
      </p>

      <div className="mt-7 rounded-xl border border-zavron-line bg-zavron-bg1/30 p-5">
        <ComposeForm
          brandId={resolved.activeBrandId}
          channels={channels.map((channel) => ({
            id: channel.id,
            platform: channel.platform,
            accountRef: channel.accountRef,
            status: channel.status,
          }))}
        />
      </div>
    </main>
  );
}
