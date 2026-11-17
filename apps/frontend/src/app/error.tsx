"use client";

/**
 * Route-level error boundary.
 *
 * It renders inside the root layout, so no `<html>`/`<body>` here. This version hands the component
 * `{ error: unknown, retry }` — `retry` has been stable since 16.3 and re-fetches before re-rendering,
 * which is the recovery the docs prescribe; bare `reset` only clears state.
 *
 * The thrown value may be anything a component threw, so narrow it before reading `digest`, and show
 * nothing derived from it in production — Next already logs the error server-side.
 */
import Link from "next/link";

function devDigest(error: unknown): string | null {
  if (process.env.NODE_ENV === "production") return null;
  if (!(error instanceof Error)) return null;
  const digest: unknown = "digest" in error ? error.digest : null;
  return typeof digest === "string" ? digest : null;
}

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = devDigest(error);

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
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zavron-accent">Error</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-zavron-ink">
          Something went wrong rendering this page.
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-zavron-muted">
          The failure was logged. Trying again re-fetches the page; if it keeps failing, the status
          page says whether the database and bindings are healthy.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => retry()}
            className="rounded-lg bg-zavron-accent px-5 py-3 text-sm font-semibold text-[#0d0d0d] transition-colors hover:bg-zavron-accent-soft"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-lg border border-zavron-line px-5 py-3 text-sm font-medium text-zavron-ink transition-colors hover:border-zavron-muted"
          >
            Go home
          </Link>
          <Link
            href="/health"
            className="px-2 py-3 text-sm text-zavron-muted transition-colors hover:text-zavron-ink"
          >
            Status
          </Link>
        </div>

        {digest ? (
          <p className="mt-8 font-mono text-xs text-zavron-muted">Digest: {digest}</p>
        ) : null}
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
