/**
 * Intake: hand a finished asset to the board.
 *
 * The same door the agent uses, opened with a session instead of a token. One implementation of the
 * rules means a rejection here is the rejection Hermes would also get.
 */
import Link from "next/link";
import { redirect } from "next/navigation";

import { currentRequest } from "@/auth/current";
import { IntakeForm } from "@/components/intake-form";
import { repository } from "@/db/repository";

export const dynamic = "force-dynamic";

export default async function IntakePage() {
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

      <h1 className="mt-5 text-2xl font-medium tracking-tight text-zavron-ink">Intake</h1>
      <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted">
        {brand?.name ?? "this brand"} · lands in review, never approved
      </p>

      <div className="mt-7 rounded-xl border border-zavron-line bg-zavron-bg1/30 p-5">
        <IntakeForm
          channels={channels.map((channel) => ({
            id: channel.id,
            platform: channel.platform,
            accountRef: channel.accountRef,
            status: channel.status,
          }))}
        />
      </div>

      {channels.length === 0 ? (
        <p className="mt-4 text-sm text-zavron-muted">
          This brand has no channels yet, so there is nowhere for a draft to go. Connect one first.
        </p>
      ) : null}
    </main>
  );
}
