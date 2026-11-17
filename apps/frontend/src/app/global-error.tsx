"use client";

/**
 * Last resort: the root layout itself failed, so this file replaces the document.
 *
 * That means it owns `<html>`/`<body>`, imports the global stylesheet itself (no layout is left to do
 * it), and cannot export `metadata` — the title is the React `<title>` element instead. The Geist
 * variables are gone with the layout, so the stylesheet's `system-ui` fallback is the honest font.
 */
import "./globals.css";
import Link from "next/link";

export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <title>Something went wrong · Postvyn</title>
        <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
          <span className="text-lg font-semibold tracking-tight text-zavron-ink">
            Postvyn<span className="text-zavron-accent">.</span>
          </span>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-zavron-ink">
            Something went wrong.
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-zavron-muted">
            The app could not render at all. Try again; if that fails, go home and reload from there.
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
          </div>
        </div>
      </body>
    </html>
  );
}
