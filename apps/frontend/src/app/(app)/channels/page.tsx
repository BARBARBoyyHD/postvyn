/**
 * Channels: which accounts this workspace can publish to, and how to connect one.
 *
 * A channel is only `active` when its credentials work, so the state is the point of the screen — a
 * token rejected by the platform reads "reconnect required", not a blank row. Connecting is
 * owner-only (`channel.connect`); the form is not drawn for anyone else.
 *
 * YouTube is the platform this screen connects by hand: its three OAuth2 values are created in the
 * Google Cloud console and pasted in (no in-app Google redirect — design decision 1). Instagram and
 * Threads credentials are minted elsewhere (OAuth), and TikTok has no credential here by design.
 */
import Link from "next/link";
import { redirect } from "next/navigation";

import { currentRequest } from "@/auth/current";
import { ChannelConnect } from "@/components/channel-connect";
import { repository } from "@/db/repository";

export const dynamic = "force-dynamic";

export default async function ChannelsPage() {
  const { env, resolved } = await currentRequest();
  if (!env || !resolved) redirect("/sign-in");

  const channels = await repository(env).listChannels(resolved.ctx);
  const activeBrand = resolved.brands?.find((brand) => brand.id === resolved.activeBrandId);
  const owner = resolved.ctx.role === "owner";
  const needsReconnect = channels.some((channel) => channel.status === "reauth_required");

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <Link
        href="/board"
        className="font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted transition-colors hover:text-zavron-ink"
      >
        ← board
      </Link>

      <h1 className="mt-5 text-2xl font-medium tracking-tight text-zavron-ink">Channels</h1>
      <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted">
        {channels.length} connected · credentials are encrypted at rest
      </p>

      <section className="mt-7">
        <h2 className="border-b border-zavron-line pb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted">
          Accounts
        </h2>

        {channels.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-zavron-line p-6 text-sm text-zavron-muted">
            Nothing connected yet. A post reaches a platform through a channel here.
          </p>
        ) : (
          <ul className="mt-3 space-y-1">
            {channels.map((channel) => (
              <li
                key={channel.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-zavron-line bg-zavron-bg1/40 px-3 py-2"
              >
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-brand-accent">
                  {channel.platform}
                </span>
                <span className="text-sm text-zavron-ink">{channel.label ?? channel.accountRef}</span>
                <span className="font-mono text-[10px] text-zavron-muted">{channel.accountRef}</span>
                <span
                  className={`ml-auto font-mono text-[10px] uppercase tracking-[0.14em] ${
                    channel.status === "reauth_required" ? "text-[#fbbf24]" : "text-zavron-muted"
                  }`}
                >
                  {channel.status === "reauth_required"
                    ? "reconnect required"
                    : channel.status === "active"
                      ? "connected"
                      : "disabled"}
                </span>
              </li>
            ))}
          </ul>
        )}

        {needsReconnect ? (
          <p className="mt-3 font-mono text-[10px] text-[#fbbf24]">
            re-enter the credentials for the same account id to restore a channel — nothing published
            to it until its state is active again.
          </p>
        ) : null}
      </section>

      {activeBrand && owner ? (
        <section className="mt-8">
          <h2 className="border-b border-zavron-line pb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted">
            Connect · {activeBrand.name}
          </h2>
          <ChannelConnect brandId={activeBrand.id} />
        </section>
      ) : null}

      {!activeBrand ? (
        <p className="mt-8 text-sm leading-relaxed text-zavron-muted">
          A channel belongs to a brand. Create or select one before connecting an account.
        </p>
      ) : null}

      {activeBrand && !owner ? (
        <p className="mt-8 text-sm leading-relaxed text-zavron-muted">
          Only an owner can connect an account.
        </p>
      ) : null}
    </main>
  );
}
