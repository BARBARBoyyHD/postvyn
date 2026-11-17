"use client";

/**
 * The upload button.
 *
 * One click approves what is on screen and pushes every channel of this post. The click is the human gate,
 * which is why the button is only rendered for an owner and why it names what it is about to do.
 *
 * The result is reported per platform, including the honest `not_connected` while an adapter is missing —
 * a button that said "done" when nothing was posted would be worse than no button.
 *
 * The click names every destination (platform + account); the server refuses a confirmation that does
 * not match the variant's channel instead of quietly sending somewhere else.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

interface Outcome {
  platform: string;
  verdict: string;
  detail?: string;
  url?: string | null;
}

export function PublishNowButton({
  postId,
  variantCount,
  targets,
  disabled,
}: {
  postId: string;
  variantCount: number;
  /** Every platform account this button is about to send to — the server refuses a mismatch. */
  targets: { platform: string; account: string }[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Outcome[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function publish() {
    setBusy(true);
    setError(null);
    setResults(null);

    const response = await fetch(`/api/v1/posts/${postId}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approveMissing: true, confirm: targets }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: { outcomes: Outcome[] };
      error?: string;
      detail?: unknown;
    };
    setBusy(false);

    if (!body.ok || !body.result) {
      setError(body.error ?? `failed (${response.status})`);
      return;
    }

    setResults(body.result.outcomes);
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-zavron-line bg-zavron-bg1/40 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
            upload
          </p>
          <p className="text-sm text-zavron-ink">
            {variantCount} channel{variantCount === 1 ? "" : "s"} · approves what is on screen, then sends
          </p>
        </div>
        <button
          type="button"
          onClick={() => void publish()}
          disabled={busy || disabled || variantCount === 0}
          className="ml-auto rounded-md bg-zavron-accent px-4 py-2 text-sm font-medium text-zavron-bg0 disabled:opacity-50"
        >
          {busy ? "publishing…" : "Upload to all channels"}
        </button>
      </div>

      {error ? <p className="mt-2 font-mono text-[11px] text-[#f43f5e]">{error}</p> : null}

      {results ? (
        <ul className="mt-3 space-y-1">
          {results.map((outcome) => (
            <li key={outcome.platform} className="font-mono text-[11px]">
              <span className={verdictColor(outcome.verdict)}>{outcome.platform}</span>
              <span className="text-zavron-muted"> · {outcome.verdict}</span>
              {outcome.detail ? <span className="text-zavron-muted/70"> — {outcome.detail}</span> : null}
              {outcome.url ? (
                <a href={outcome.url} className="ml-2 underline decoration-zavron-line">
                  open
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function verdictColor(verdict: string): string {
  switch (verdict) {
    case "published":
      return "text-[#5eead4]";
    case "failed":
    case "reapproval_required":
      return "text-[#f43f5e]";
    case "awaiting_platform":
    case "not_connected":
      return "text-[#fbbf24]";
    default:
      return "text-zavron-ink";
  }
}
