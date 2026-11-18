/**
 * The signed-in shell.
 *
 * Two jobs only: refuse anyone without a session, and put the chrome around every app page. Everything
 * that varies per page stays in that page — a layout that fetches board data would re-fetch it for
 * every route underneath it.
 *
 * The chrome is Zavron (`--color-zavron-*`); the active brand paints the content surfaces through
 * `--color-brand-*`, set here so a page never has to know how to read `brand.json`. The navigation
 * itself is client (it highlights the current route), so every piece of data it needs is passed down.
 *
 * shadcn's `SidebarInset` is a `<main>`, and every page already renders its own `<main>` — nesting
 * them would be a document with two mains. The equivalent flex column stands in.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { currentRequest } from "@/auth/current";
import { AppMobileBar } from "@/components/app-mobile-bar";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
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
          This page needs D1. Run <code className="text-zavron-ink">pnpm dev</code> — the Worker runtime
          with a database binding; <code className="text-zavron-ink">pnpm dev:next</code> renders pages
          without one.
        </p>
      </main>
    );
  }

  if (!resolved) redirect("/sign-in");

  const active = resolved.brands?.find((brand) => brand.id === resolved.activeBrandId);
  const accent = active ? readAccent(active.colors) : null;

  // One scoped row for the chrome: the chip must reflect the workspace switch, not just the deploy.
  const settings = await repository(env).getWorkspaceSettings(resolved.ctx);

  // Read server-side so the first paint matches the last click; the provider writes it on toggle.
  const sidebarOpen = (await cookies()).get("sidebar_state")?.value !== "false";

  return (
    <div
      className="min-h-svh bg-zavron-bg0"
      style={
        {
          "--color-brand-accent": accent ?? "var(--color-zavron-accent)",
        } as React.CSSProperties
      }
    >
      <TooltipProvider>
        <SidebarProvider defaultOpen={sidebarOpen}>
          <AppSidebar
            brands={resolved.brands ?? []}
            activeBrandId={resolved.activeBrandId}
            role={resolved.ctx.role}
            globalEnabled={env.PUBLISHING_ENABLED === "true"}
            workspaceEnabled={Boolean(settings?.publishingEnabled)}
          />

          <div className="flex min-w-0 flex-1 flex-col bg-zavron-bg0">
            <AppMobileBar brands={resolved.brands ?? []} activeBrandId={resolved.activeBrandId} />
            <div className="min-w-0 flex-1">{children}</div>
            <footer className="border-t border-zavron-line px-5 py-3">
              <p className="mx-auto max-w-[1400px] font-mono text-[10px] uppercase tracking-[0.18em] text-zavron-muted">
                Postvyn · built by Zavron
              </p>
            </footer>
          </div>
        </SidebarProvider>
      </TooltipProvider>
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
