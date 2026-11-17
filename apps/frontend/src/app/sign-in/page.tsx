"use client";

/**
 * Sign-in.
 *
 * Deliberately plain: one form, one endpoint (Better Auth's `/api/auth/sign-in/email`), one honest
 * error line. The full app shell — verification screens, password reset, brand switcher — is M1 work
 * that is not built yet, and a decorative half-shell would be worse than this.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        // Better Auth answers 401 for bad credentials and 403 for unverified — say which, plainly.
        const body = (await response.json().catch(() => ({}))) as { message?: string; code?: string };
        setError(
          body.code === "EMAIL_NOT_VERIFIED" || response.status === 403
            ? "That account cannot sign in yet. Ask the operator to check it."
            : (body.message ?? "That email and password do not match an account."),
        );
        return;
      }

      router.push("/health");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

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

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight text-zavron-ink">Sign in</h1>

        <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted">
              Email
            </span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="rounded-lg border border-zavron-line bg-zavron-bg1/60 px-3 py-2.5 text-sm text-zavron-ink placeholder:text-zavron-muted/60 focus:border-zavron-accent focus:outline-none"
              placeholder="you@example.com"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted">
              Password
            </span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="rounded-lg border border-zavron-line bg-zavron-bg1/60 px-3 py-2.5 text-sm text-zavron-ink placeholder:text-zavron-muted/60 focus:border-zavron-accent focus:outline-none"
              placeholder="••••••••••"
            />
          </label>

          {error ? (
            <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="mt-1 rounded-lg bg-zavron-accent px-5 py-3 text-sm font-semibold text-[#0d0d0d] transition-colors hover:bg-zavron-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="mt-8 border-t border-zavron-line/60 pt-6">
          <p className="text-sm text-zavron-muted">No account yet?</p>
          <Link
            href="/register"
            className="mt-3 inline-flex rounded-lg border border-zavron-line px-5 py-3 text-sm font-medium text-zavron-ink transition-colors hover:border-zavron-muted"
          >
            Create an account
          </Link>
        </div>

        <p className="mt-6 text-xs leading-relaxed text-zavron-muted">
          Password reset is wired to Resend but not yet verified against a live inbox. If you are locked
          out, the honest fix today is a database-level password change by the operator.
        </p>
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
