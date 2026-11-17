"use client";

/**
 * Sign-up.
 *
 * The endpoint is Better Auth's, behind the guard in `api/auth/[...all]`, so this form does the two
 * things the library cannot: collect a `name` (the column is NOT NULL and workspace provisioning
 * derives its name from it) and carry a Turnstile token, because sign-up sends mail to an address
 * the caller chose.
 *
 * Turnstile tokens are single-use, so the widget is reset after every attempt. A retry with a
 * consumed token is a 403 that reads like a captcha failure the user did not cause.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileOptions {
  sitekey: string;
  theme?: "auto" | "light" | "dark";
  callback: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
}

/** The slice of Cloudflare's widget API this form uses — declared, not `any`. */
interface TurnstileInstance {
  render(container: HTMLElement, options: TurnstileOptions): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileInstance;
  }
}

/** Loaded once per document; the widget API defines `window.turnstile` before `load` fires. */
let loading: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      reject(new Error("Turnstile did not load"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

interface AuthReply {
  message?: string;
  error?: string;
  detail?: string;
}

/** Both Better Auth's body and the guard's envelope are untyped JSON. Read the fields, never cast. */
function readAuthReply(value: unknown): AuthReply {
  if (typeof value !== "object" || value === null) return {};
  const source: Record<string, unknown> = { ...value };
  const reply: AuthReply = {};
  if (typeof source.message === "string") reply.message = source.message;
  if (typeof source.error === "string") reply.error = source.error;
  if (typeof source.detail === "string") reply.detail = source.detail;
  return reply;
}

function signUpError(status: number, reply: AuthReply): string {
  if (status === 403) {
    if (reply.detail === "turnstile_not_configured") {
      return "Registration isn't configured on this server (TURNSTILE_SECRET_KEY missing).";
    }
    if (reply.detail === "turnstile_test_key_in_production") {
      return "Registration is misconfigured on this server: it is still using Cloudflare's test captcha key.";
    }
    return "The captcha check failed. Try again.";
  }
  if (status === 409) return "An account with that email already exists.";
  if (status === 422) {
    return reply.message ?? "The server refused those details. The password needs at least 10 characters.";
  }
  if (status === 429) {
    return "Too many sign-up attempts from this address — three per five minutes. Try again shortly.";
  }
  if (status === 503) {
    return "This server cannot create accounts: it has no database binding. Run the app on the Worker runtime (pnpm dev:vinext) instead.";
  }
  return reply.message ?? `Sign-up failed (${status}).`;
}

interface RegisterFormProps {
  siteKey: string;
  /** False when the server has no Resend key, so the verification link only reaches the dev outbox. */
  mailConfigured: boolean;
}

export function RegisterForm({ siteKey, mailConfigured }: RegisterFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);
  const token = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    loadTurnstile()
      .then(() => {
        const turnstile = window.turnstile;
        const container = containerRef.current;
        if (!active || !turnstile || !container) return;
        widgetId.current = turnstile.render(container, {
          sitekey: siteKey,
          theme: "dark",
          callback: (value) => {
            token.current = value;
          },
          "expired-callback": () => {
            token.current = null;
          },
          "error-callback": () => {
            token.current = null;
          },
        });
      })
      .catch(() => {
        if (active) setError("The captcha could not load. Reload the page and try again.");
      });

    return () => {
      active = false;
      const turnstile = window.turnstile;
      const id = widgetId.current;
      if (turnstile && id) {
        turnstile.remove(id);
        widgetId.current = null;
        token.current = null;
      }
    };
  }, [siteKey]);

  function resetCaptcha() {
    token.current = null;
    const turnstile = window.turnstile;
    const id = widgetId.current;
    if (turnstile && id) turnstile.reset(id);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!token.current) {
      setError("Complete the captcha check first.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, email, password, turnstileToken: token.current }),
      });

      if (!response.ok) {
        setError(signUpError(response.status, readAuthReply(await response.json().catch(() => ({})))));
        return;
      }

      setCreated(true);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
      resetCaptcha();
    }
  }

  if (created) {
    return (
      <div role="status" className="mt-8 rounded-xl border border-zavron-line bg-zavron-bg1/50 p-6">
        <p className="text-sm font-semibold text-zavron-ink">Account created.</p>
        <p className="mt-2 text-sm leading-relaxed text-zavron-muted">
          Check your email for the verification link — you cannot sign in until the address is
          verified.
          {mailConfigured
            ? null
            : " This server has no mail delivery configured, so nothing actually left it: the link was only recorded in its dev outbox. Ask the operator to verify the account by hand."}
        </p>
        <Link
          href="/sign-in"
          className="mt-4 inline-block text-sm font-medium text-zavron-ink underline decoration-zavron-line underline-offset-4 hover:decoration-zavron-accent"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
      <label className="flex flex-col gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted">
          Name
        </span>
        <input
          type="text"
          name="name"
          autoComplete="name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="rounded-lg border border-zavron-line bg-zavron-bg1/60 px-3 py-2.5 text-sm text-zavron-ink placeholder:text-zavron-muted/60 focus:border-zavron-accent focus:outline-none"
          placeholder="Your name"
        />
      </label>

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
          autoComplete="new-password"
          minLength={10}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="rounded-lg border border-zavron-line bg-zavron-bg1/60 px-3 py-2.5 text-sm text-zavron-ink placeholder:text-zavron-muted/60 focus:border-zavron-accent focus:outline-none"
          placeholder="••••••••••"
        />
        <span className="text-xs text-zavron-muted">At least 10 characters.</span>
      </label>

      <div ref={containerRef} className="min-h-[65px]" />

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="mt-1 rounded-lg bg-zavron-accent px-5 py-3 text-sm font-semibold text-[#0d0d0d] transition-colors hover:bg-zavron-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}
