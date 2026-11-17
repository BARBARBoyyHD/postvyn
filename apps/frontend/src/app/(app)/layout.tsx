/**
 * The signed-in shell.
 *
 * Two jobs only: refuse anyone without a session, and put the chrome around every app page. Everything
 * that varies per page stays in that page — a layout that fetches board data would re-fetch it for
 * every route underneath it.
 *
 * The chrome is Zavron (`--color-zavron-*`); the active brand paints the content surfaces through
 * `--color-brand-*`, set here so a page never has to know how to read `brand.json`.
 */
import Link from "next/link";
import { redirect } from "next/navigation";

import { currentRequest } from "@/auth/current";
import { BrandSwitcher } from "@/components/brand-switcher";
import { PublishingState } from "@/components/publishing-state";
import { SignOutButton } from "@/components/sign-out-button";
import { repository } from "@/db/repository";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { env, resolved } = await currentRequest();

  // No Worker bindings means no session store: saying so beats a 500 with a stack trace.
  if (!env) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-24">
        <h1 className="text-xl font-medium text-zavron-ink">No Worker bindings</h1>
        <p className="mt-3 text-sm leading-relaxed text-zavron-muted">
          This page needs D1. Run <code className="text-zavron-ink">pnpm dev:vinext</code> — plain{" "}
          <code className="text-zavron-ink">pnpm dev</code> has no Worker and therefore no database.
        </p>
      </main>
    );
  }

  if (!resolved) redirect("/sign-in");

  const active = resolved.brands?.find((brand) => brand.id === resolved.activeBrandId);
  const accent = active ? readAccent(active.colors) : null;

  // One scoped row for the chrome: the chip must reflect the workspace switch, not just the deploy.
  const settings = await repository(env).getWorkspaceSettings(resolved.ctx);

  return (
    <div
      className="flex min-h-screen flex-col bg-zavron-bg0"
      style={
        {
          "--color-brand-accent": accent ?? "var(--color-zavron-accent)",
        } as React.CSSProperties
      }
    >
      <header className="sticky top-0 z-20 border-b border-zavron-line bg-zavron-bg0/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-5">
          <Link href="/board" className="flex items-baseline gap-2">
            <span className="text-sm font-semibold tracking-tight text-zavron-ink">Postvyn</span>
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-zavron-accent" />
          </Link>

          <nav className="flex items-center gap-4 font-mono text-[11px] uppercase tracking-[0.18em]">
            <Link href="/board" className="text-zavron-muted transition-colors hover:text-zavron-ink">
              board
            </Link>
            <Link href="/review" className="text-zavron-muted transition-colors hover:text-zavron-ink">
              review
            </Link>
            <Link href="/compose" className="text-zavron-muted transition-colors hover:text-zavron-ink">
              compose
            </Link>
            <Link href="/intake" className="text-zavron-muted transition-colors hover:text-zavron-ink">
              intake
            </Link>
            <Link
              href="/channels"
              className="text-zavron-muted transition-colors hover:text-zavron-ink"
            >
              channels
            </Link>
            <Link href="/health" className="text-zavron-muted transition-colors hover:text-zavron-ink">
              health
            </Link>
          </nav>

          <div className="ml-auto flex items-center gap-5">
            <span className="hidden sm:inline">
              <PublishingState
                globalEnabled={env.PUBLISHING_ENABLED === "true"}
                workspaceEnabled={Boolean(settings?.publishingEnabled)}
              />
            </span>
            <BrandSwitcher brands={resolved.brands ?? []} activeBrandId={resolved.activeBrandId} />
            <span className="hidden font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted sm:inline">
              {resolved.ctx.role}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="flex-1">{children}</div>

      <footer className="border-t border-zavron-line px-5 py-4">
        <p className="mx-auto max-w-[1400px] font-mono text-[10px] uppercase tracking-[0.18em] text-zavron-muted">
          Postvyn · built by Zavron
        </p>
      </footer>
    </div>
  );
}

/** `brand.json`'s colours, read defensively — a malformed value must not take the shell down. */
function readAccent(colors: string | null): string | null {
  if (!colors) return null;
  try {
    const parsed = JSON.parse(colors) as { accent?: unknown };
    return typeof parsed.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(parsed.accent)
      ? parsed.accent
      : null;
  } catch {
    return null;
  }
}
