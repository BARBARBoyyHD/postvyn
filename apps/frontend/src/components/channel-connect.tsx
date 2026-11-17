"use client";

/**
 * Connect a YouTube channel.
 *
 * The three values come from a Google Cloud project the operator made: an OAuth client id, its secret,
 * and a refresh token obtained by running the consent flow outside this app. There is no in-app Google
 * redirect (design decision 1) — the same enter-in-the-app path Meta already takes — so the guidance on
 * screen is the product here, not decoration: a consent screen left in Testing hands out refresh tokens
 * that die in seven days.
 *
 * The account id is not typed: the server reads it from the authenticated account's own channel during
 * the connect call, so a mistyped handle cannot produce a channel that looks connected and never
 * publishes. Fields are write-only, and cleared after a successful connect.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

const FIELDS = [
  { name: "clientId", label: "Client id", hint: "…apps.googleusercontent.com" },
  { name: "clientSecret", label: "Client secret", hint: "from the same OAuth client" },
  { name: "refreshToken", label: "Refresh token", hint: "from the consent flow" },
] as const;

type FieldName = (typeof FIELDS)[number]["name"];

const EMPTY: Record<FieldName, string> = { clientId: "", clientSecret: "", refreshToken: "" };

export function ChannelConnect({ brandId }: { brandId: string }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [credentials, setCredentials] = useState<Record<FieldName, string>>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<string | null>(null);

  const complete = FIELDS.every((field) => credentials[field.name] !== "");

  async function connect() {
    setBusy(true);
    setError(null);
    setConnected(null);

    const response = await fetch("/api/v1/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        brandId,
        platform: "youtube",
        ...(label.trim() ? { label: label.trim() } : {}),
        credentials,
      }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: { id: string; accountRef: string; label: string | null };
      error?: string;
      detail?: { message?: string; code?: string };
    } | null;
    setBusy(false);

    if (!response || !body?.ok) {
      setError(connectError(body?.error, body?.detail, response?.status));
      return;
    }

    setConnected(body.result?.label ?? body.result?.accountRef ?? "this channel");
    setLabel("");
    setCredentials(EMPTY);
    router.refresh();
  }

  return (
    <form
      className="mt-3 rounded-xl border border-zavron-line bg-zavron-bg1/40 px-4 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        void connect();
      }}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
        connect a YouTube channel
      </p>

      <ol className="mt-3 space-y-1 text-sm leading-relaxed text-zavron-muted">
        <li>1. In Google Cloud, enable <span className="text-zavron-ink">YouTube Data API v3</span>.</li>
        <li>2. Create an OAuth client (type: Desktop or Web) and paste its id and secret below.</li>
        <li>
          3. Publish the OAuth consent screen to{" "}
          <span className="text-zavron-ink">In production</span> — left in Testing, every refresh token
          dies after 7 days.
        </li>
        <li>
          4. Run the consent flow outside this app (OAuth Playground works) with{" "}
          <span className="text-zavron-ink">youtube.upload</span> and{" "}
          <span className="text-zavron-ink">youtube.readonly</span>, then paste the refresh token. The
          read scope is what lets the app verify an upload before calling it published.
        </li>
      </ol>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <label key={field.name} className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
              {field.label} <span className="normal-case tracking-normal">({field.hint})</span>
            </span>
            <input
              type="password"
              value={credentials[field.name]}
              onChange={(event) =>
                setCredentials((previous) => ({ ...previous, [field.name]: event.target.value }))
              }
              required
              autoComplete="off"
              spellCheck={false}
              className="rounded border border-zavron-line bg-zavron-bg0/60 px-2 py-1.5 font-mono text-[11px] text-zavron-ink focus:border-zavron-accent focus:outline-none"
            />
          </label>
        ))}

        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
            label <span className="normal-case tracking-normal">(optional)</span>
          </span>
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="how this channel appears on the board"
            className="rounded border border-zavron-line bg-zavron-bg0/60 px-2 py-1.5 text-sm text-zavron-ink placeholder:text-zavron-muted focus:border-zavron-accent focus:outline-none"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy || !complete}
          className="rounded bg-zavron-accent px-3 py-1.5 text-sm font-medium text-zavron-bg0 disabled:opacity-50"
        >
          {busy ? "checking…" : "Connect YouTube"}
        </button>
        <span className="font-mono text-[10px] text-zavron-muted/60">
          owner only · encrypted at rest, never shown again
        </span>
      </div>

      {connected ? (
        <p className="mt-3 font-mono text-[10px] text-[#5eead4]">connected · {connected}</p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 font-mono text-[11px] text-[#f43f5e]">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** Each refusal names the one thing to fix; the server's own message wins for a missing key. */
function connectError(
  error: string | undefined,
  detail: { message?: string; code?: string } | undefined,
  status: number | undefined,
): string {
  switch (error) {
    case "invalid_channel":
      return "all three values are required — client id, client secret and refresh token.";
    case "credentials_rejected":
      // Google's own code: `invalid_grant` is the Testing-mode / revoked / unused-for-six-months grant.
      return detail?.code === "invalid_grant"
        ? "Google refused the refresh token (invalid_grant) — re-run the consent flow with the screen In production, then paste the new token."
        : `Google refused these credentials: ${detail?.message ?? detail?.code ?? "no reason given"}.`;
    case "forbidden":
      return "only an owner can connect a channel.";
    case "token_key_unavailable":
      return detail?.message ?? "server encryption key is not configured — nothing was stored.";
    case "not_found":
      return "this brand no longer exists — reload the page.";
    default:
      return `${error ?? "could not connect"} (${status ?? "network"})`;
  }
}
