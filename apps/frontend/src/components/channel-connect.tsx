"use client";

/**
 * Connect an X account.
 *
 * X's API needs four values (OAuth 1.0a); they go to `POST /api/v1/channels` and are encrypted at rest.
 * The fields are write-only by construction: nothing here reads a stored credential back, and every
 * input is cleared after a successful connect, because a value left in the DOM is a value on a screen.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

const FIELDS = [
  { name: "apiKey", label: "API key", hint: "consumer key" },
  { name: "apiSecret", label: "API secret", hint: "consumer secret" },
  { name: "accessToken", label: "Access token", hint: "user token" },
  { name: "accessSecret", label: "Access secret", hint: "user token secret" },
] as const;

type FieldName = (typeof FIELDS)[number]["name"];

export function ChannelConnect({ brandId }: { brandId: string }) {
  const router = useRouter();
  const [accountRef, setAccountRef] = useState("");
  const [label, setLabel] = useState("");
  const [credentials, setCredentials] = useState<Record<FieldName, string>>({
    apiKey: "",
    apiSecret: "",
    accessToken: "",
    accessSecret: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<string | null>(null);

  const complete = accountRef.trim() !== "" && FIELDS.every((field) => credentials[field.name] !== "");

  async function connect() {
    setBusy(true);
    setError(null);
    setConnected(null);

    const response = await fetch("/api/v1/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        brandId,
        platform: "x",
        accountRef: accountRef.trim(),
        ...(label.trim() ? { label: label.trim() } : {}),
        credentials,
      }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: { id: string; accountRef: string; label: string | null };
      error?: string;
      detail?: { message?: string };
    } | null;
    setBusy(false);

    if (!response || !body?.ok) {
      setError(connectError(body?.error, body?.detail?.message, response?.status));
      return;
    }

    setConnected(body.result?.label ?? body.result?.accountRef ?? accountRef.trim());
    setAccountRef("");
    setLabel("");
    setCredentials({ apiKey: "", apiSecret: "", accessToken: "", accessSecret: "" });
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
        connect an X account
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
            account id
          </span>
          <input
            value={accountRef}
            onChange={(event) => setAccountRef(event.target.value)}
            required
            placeholder="the platform's numeric user id"
            className="rounded border border-zavron-line bg-zavron-bg0/60 px-2 py-1.5 font-mono text-[11px] text-zavron-ink placeholder:text-zavron-muted focus:border-zavron-accent focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
            label <span className="normal-case tracking-normal">(optional)</span>
          </span>
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="how this account appears on the board"
            className="rounded border border-zavron-line bg-zavron-bg0/60 px-2 py-1.5 text-sm text-zavron-ink placeholder:text-zavron-muted focus:border-zavron-accent focus:outline-none"
          />
        </label>

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
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy || !complete}
          className="rounded bg-zavron-accent px-3 py-1.5 text-sm font-medium text-zavron-bg0 disabled:opacity-50"
        >
          {busy ? "connecting…" : "Connect X"}
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
  detail: string | undefined,
  status: number | undefined,
): string {
  switch (error) {
    case "invalid_channel":
      return "check every field — all four credentials and the account id are required.";
    case "forbidden":
      return "only an owner can connect an account.";
    case "token_key_unavailable":
      return detail ?? "server encryption key is not configured — nothing was stored.";
    case "not_found":
      return "this brand no longer exists — reload the page.";
    default:
      return `${error ?? "could not connect"} (${status ?? "network"})`;
  }
}
