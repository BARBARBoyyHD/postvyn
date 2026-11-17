/**
 * 404.
 *
 * The root `not-found` file handles every unmatched URL for the whole app and renders inside the
 * root layout — so it is a Server Component with no props. It ships with every route, so it must
 * stay free of client components.
 */
import Link from "next/link";

export const metadata = {
  title: "Not found",
  description: "That page does not exist — or moved.",
};

export default function NotFound() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-zavron-line/70">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-semibold tracking-tight text-zavron-ink">
            Postvyn<span className="text-zavron-accent">.</span>
          </Link>
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted">
            by Zavron
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-16">
        <p className="font-mono text-5xl font-medium tracking-tight text-zavron-accent">404</p>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight text-zavron-ink">
          That page does not exist — or moved.
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-zavron-muted">
          The address you followed points at nothing here. The board, the queue and the status page
          are where they were.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/"
            className="rounded-lg bg-zavron-accent px-5 py-3 text-sm font-semibold text-[#0d0d0d] transition-colors hover:bg-zavron-accent-soft"
          >
            Back to Postvyn
          </Link>
          <Link
            href="/sign-in"
            className="rounded-lg border border-zavron-line px-5 py-3 text-sm font-medium text-zavron-ink transition-colors hover:border-zavron-muted"
          >
            Sign in
          </Link>
          <Link
            href="/health"
            className="px-2 py-3 text-sm text-zavron-muted transition-colors hover:text-zavron-ink"
          >
            Status
          </Link>
        </div>
      </main>

      <footer className="border-t border-zavron-line/70">
        <div className="mx-auto w-full max-w-5xl px-6 py-6 text-xs text-zavron-muted">
          <Link href="/" className="hover:text-zavron-ink">
            ← Back to Postvyn
          </Link>
        </div>
      </footer>
    </div>
  );
}
