"use client";

/**
 * Connect a YouTube, Instagram or Threads channel.
 *
 * The credentials are minted outside this app and pasted in — no in-app redirect, for either platform
 * family (design decision 1). Fields are write-only and cleared after a successful connect. The
 * account id is typed only where the platform cannot report it for us: YouTube's is read from the
 * authenticated account's own channel during the connect call.
 *
 * The three fields below are the keys the adapters actually read: `meta.ts` takes `accessToken` for
 * both Meta platforms, `youtube-auth.ts` takes `clientId`/`clientSecret`/`refreshToken`.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

const PLATFORMS = ["youtube", "instagram", "threads"] as const;
type Platform = (typeof PLATFORMS)[number];

interface Field {
  name: string;
  label: string;
  hint: string;
}

interface PlatformConfig {
  label: string;
  /** The label for the account-id input, or null when the server derives it. */
  accountRef: string | null;
  fields: Field[];
}

const CONFIG: Record<Platform, PlatformConfig> = {
  youtube: {
    label: "YouTube",
    accountRef: null,
    fields: [
      { name: "clientId", label: "Client id", hint: "…apps.googleusercontent.com" },
      { name: "clientSecret", label: "Client secret", hint: "from the same OAuth client" },
      { name: "refreshToken", label: "Refresh token", hint: "from the consent flow" },
    ],
  },
  instagram: {
    label: "Instagram",
    accountRef: "the account's numeric id, not the handle",
    fields: [
      { name: "accessToken", label: "Access token", hint: "long-lived, minted in Meta's OAuth flow" },
    ],
  },
  threads: {
    label: "Threads",
    accountRef: "the user's numeric id, not the handle",
    fields: [
      { name: "accessToken", label: "Access token", hint: "long-lived, minted in Meta's OAuth flow" },
    ],
  },
};

const STEPS: Record<Platform, string[]> = {
  youtube: [
    "In Google Cloud, enable YouTube Data API v3.",
    "Create an OAuth client (type: Desktop or Web) and paste its id and secret below.",
    "Publish the OAuth consent screen to In production — left in Testing, every refresh token dies after 7 days.",
    "Run the consent flow outside this app (OAuth Playground works) with youtube.upload and youtube.readonly, then paste the refresh token. The read scope is what lets the app verify an upload before calling it published.",
  ],
  instagram: [
    "Mint a long-lived Instagram token in Meta's OAuth flow, outside this app.",
    "Paste the token and the account's numeric id below.",
  ],
  threads: [
    "Mint a long-lived Threads token in Meta's OAuth flow, outside this app.",
    "Paste the token and the user's numeric id below.",
  ],
};

export function ChannelConnect({ brandId }: { brandId: string }) {
  const router = useRouter();
  const [platform, setPlatform] = useState<Platform>("youtube");
  const [label, setLabel] = useState("");
  const [accountRef, setAccountRef] = useState("");
  const [credentials, setCredentials] = useState<Record<string, string>>(() =>
    emptyCredentials("youtube"),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<string | null>(null);

  const config = CONFIG[platform];
  const complete =
    config.fields.every((field) => (credentials[field.name] ?? "") !== "") &&
    (config.accountRef === null || accountRef.trim() !== "");

  function onPlatformChange(next: Platform) {
    setPlatform(next);
    setCredentials(emptyCredentials(next));
    setAccountRef("");
    setError(null);
    setConnected(null);
  }

  async function connect() {
    setBusy(true);
    setError(null);
    setConnected(null);

    const response = await fetch("/api/v1/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        brandId,
        platform,
        ...(config.accountRef === null ? {} : { accountRef: accountRef.trim() }),
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
      setError(connectError(body?.error, body?.detail, response?.status, config.label));
      return;
    }

    setConnected(body.result?.label ?? body.result?.accountRef ?? "this channel");
    setLabel("");
    setAccountRef("");
    setCredentials(emptyCredentials(platform));
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
      <label className="flex flex-col gap-1 sm:max-w-xs">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
          platform
        </span>
        <select
          value={platform}
          onChange={(event) => {
            const next = PLATFORMS.find((id) => id === event.target.value);
            if (next) onPlatformChange(next);
          }}
          className="rounded border border-zavron-line bg-zavron-bg0/60 px-2 py-1.5 text-sm text-zavron-ink focus:border-zavron-accent focus:outline-none"
        >
          {PLATFORMS.map((id) => (
            <option key={id} value={id}>
              {CONFIG[id].label}
            </option>
          ))}
        </select>
      </label>

      <ol className="mt-3 space-y-1 text-sm leading-relaxed text-zavron-muted">
        {STEPS[platform].map((step, index) => (
          <li key={step}>
            {index + 1}. {step}
          </li>
        ))}
      </ol>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {config.accountRef === null ? null : (
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
              account id{" "}
              <span className="normal-case tracking-normal">({config.accountRef})</span>
            </span>
            <input
              value={accountRef}
              onChange={(event) => setAccountRef(event.target.value)}
              required
              spellCheck={false}
              className="rounded border border-zavron-line bg-zavron-bg0/60 px-2 py-1.5 font-mono text-[11px] text-zavron-ink focus:border-zavron-accent focus:outline-none"
            />
          </label>
        )}

        {config.fields.map((field) => (
          <label key={field.name} className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
              {field.label} <span className="normal-case tracking-normal">({field.hint})</span>
            </span>
            <input
              type="password"
              value={credentials[field.name] ?? ""}
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
          {busy ? "checking…" : `Connect ${config.label}`}
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

function emptyCredentials(platform: Platform): Record<string, string> {
  return Object.fromEntries(CONFIG[platform].fields.map((field) => [field.name, ""]));
}

/** Each refusal names the one thing to fix; the server's own message wins for a missing key. */
function connectError(
  error: string | undefined,
  detail: { message?: string; code?: string } | undefined,
  status: number | undefined,
  platformLabel: string,
): string {
  switch (error) {
    case "invalid_channel":
      return "every field is required — the credentials, and the account id for Instagram and Threads.";
    case "credentials_rejected":
      // Google's own code: `invalid_grant` is the Testing-mode / revoked / unused-for-six-months grant.
      return detail?.code === "invalid_grant"
        ? "Google refused the refresh token (invalid_grant) — re-run the consent flow with the screen In production, then paste the new token."
        : `${platformLabel} refused these credentials: ${detail?.message ?? detail?.code ?? "no reason given"}.`;
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
