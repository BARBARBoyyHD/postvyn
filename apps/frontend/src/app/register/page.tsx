/**
 * Sign-up.
 *
 * Mirrors sign-in's shell deliberately: same header, same footer, same one-form honesty. The one
 * server-only difference is the Turnstile site key, which lives in the Worker bindings — so it is
 * read here and handed to the client form as a prop. The key is public by design; the secret never
 * leaves the server, and the guard fails closed without it.
 *
 * `force-dynamic` because bindings are per-request state, not build-time constants.
 */
import Link from "next/link";
import { RegisterForm } from "@/components/register-form";
import { getBindings } from "@/lib/bindings";
import { turnstileTestKeys } from "@/lib/turnstile";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Create an account",
  description: "Create a Postvyn account. The address is verified by email before the first sign-in.",
};

export default async function RegisterPage() {
  const env = await getBindings();
  const siteKey = env?.TURNSTILE_SITE_KEY ?? turnstileTestKeys.siteKey;

  // Without these two the mailer falls back to an in-memory outbox (src/lib/email). Promising an
  // inbox email that was never sent is exactly the kind of lie this product does not tell.
  const mailConfigured = Boolean(env?.RESEND_API_KEY && env?.EMAIL_FROM);

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
        <h1 className="text-2xl font-semibold tracking-tight text-zavron-ink">Create an account</h1>
        <p className="mt-2 text-sm text-zavron-muted">
          Sign-up sends a verification link. The account stays locked until the address is confirmed.
        </p>

        <RegisterForm siteKey={siteKey} mailConfigured={mailConfigured} />

        {env ? null : (
          <p className="mt-8 text-xs leading-relaxed text-amber-300/80">
            No Worker bindings on this runtime, so sign-up cannot succeed here: the auth route
            answers 503 without a database, and the captcha secret is absent. Use{" "}
            <code className="font-mono">pnpm dev:vinext</code> for a real local sign-up.
          </p>
        )}
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
