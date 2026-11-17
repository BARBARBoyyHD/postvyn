"use client";

/**
 * The upload control, in two steps.
 *
 * The first click is a dry run: it asks the server what a publish would send and shows the calls,
 * the notes and — above all — the estimated spend, because money is shown before it is spent
 * (non-negotiable 6). Only the second click approves and sends.
 *
 * The result is reported per platform, including the honest `not_connected` while an adapter is
 * missing — a button that said "done" when nothing was posted would be worse than no button. The
 * click names every destination (platform + account); the server refuses a confirmation that does
 * not match the variant's channel instead of quietly sending somewhere else.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { costLabel, usd } from "@/lib/cost";

interface Outcome {
  platform: string;
  verdict: string;
  detail?: string;
  url?: string | null;
  estimatedCostUsd?: number | null;
}

interface PreviewRow {
  variantId: string;
  platform: string;
  ok: boolean;
  calls: number;
  estimatedCostUsd: number | null;
  notes: string[];
  reason?: string;
  detail?: string;
  violations?: { field: string; level: string; message: string }[];
}

type RawPreview =
  | {
      ok: true;
      variantId: string;
      preview: { calls: unknown[]; estimatedCostUsd: number | null; notes: string[] };
    }
  | {
      ok: false;
      variantId: string;
      reason: string;
      detail?: string;
      violations?: { field: string; level: string; message: string }[];
    };

type Phase = "idle" | "previewing" | "ready" | "sending";

export function PublishNowButton({
  postId,
  targets,
  disabled,
}: {
  postId: string;
  /** Every destination this button is about to send to — the server refuses a mismatch. */
  targets: { variantId: string; platform: string; account: string }[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [previews, setPreviews] = useState<PreviewRow[] | null>(null);
  const [results, setResults] = useState<Outcome[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = phase === "previewing" || phase === "sending";
  const estimate = (previews ?? []).reduce(
    (sum, row) => sum + (row.ok && typeof row.estimatedCostUsd === "number" ? row.estimatedCostUsd : 0),
    0,
  );

  async function loadPreview() {
    setPhase("previewing");
    setError(null);
    setResults(null);
    setPreviews(null);

    const response = await fetch(`/api/v1/posts/${postId}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun: true }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: { previews?: RawPreview[] };
      error?: string;
    } | null;

    if (!response || !body?.ok || !body.result?.previews) {
      setPhase("idle");
      setError(body?.error ?? `could not preview (${response?.status ?? "network"})`);
      return;
    }

    const platforms = new Map(targets.map((target) => [target.variantId, target.platform]));
    setPreviews(
      body.result.previews.map((raw) =>
        raw.ok
          ? {
              variantId: raw.variantId,
              platform: platforms.get(raw.variantId) ?? "variant",
              ok: true,
              calls: raw.preview.calls.length,
              estimatedCostUsd: raw.preview.estimatedCostUsd,
              notes: raw.preview.notes,
            }
          : {
              variantId: raw.variantId,
              platform: platforms.get(raw.variantId) ?? "variant",
              ok: false,
              calls: 0,
              estimatedCostUsd: null,
              notes: [],
              reason: raw.reason,
              detail: raw.detail,
              violations: raw.violations,
            },
      ),
    );
    setPhase("ready");
  }

  async function send() {
    setPhase("sending");
    setError(null);

    const response = await fetch(`/api/v1/posts/${postId}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        approveMissing: true,
        confirm: targets.map(({ platform, account }) => ({ platform, account })),
      }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: { outcomes: Outcome[] };
      error?: string;
    } | null;
    setPhase("idle");

    if (!response || !body?.ok || !body.result) {
      setError(body?.error ?? `failed (${response?.status ?? "network"})`);
      return;
    }

    setPreviews(null);
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
            {targets.length} channel{targets.length === 1 ? "" : "s"} · approves what is on screen,
            then sends
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadPreview()}
          disabled={busy || disabled || targets.length === 0 || phase === "ready"}
          className="ml-auto rounded-md bg-zavron-accent px-4 py-2 text-sm font-medium text-zavron-bg0 disabled:opacity-50"
        >
          {phase === "previewing" ? "checking…" : "Review & send"}
        </button>
      </div>

      {phase === "ready" && previews ? (
        <div
          aria-live="polite"
          className="mt-3 rounded-lg border border-zavron-line bg-zavron-bg0/40 px-3 py-3"
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
              estimated spend
            </p>
            {estimate > 0 ? (
              <p className="text-lg font-medium leading-none text-zavron-ink">{usd(estimate)}</p>
            ) : (
              <p className="text-sm text-zavron-muted">nothing metered in this send</p>
            )}
            <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted/70">
              nothing has been sent
            </span>
          </div>

          <ul className="mt-2 space-y-2">
            {previews.map((row) => {
              const cost = costLabel(row.platform, row.estimatedCostUsd);
              return (
                <li key={row.variantId}>
                  <p className="flex flex-wrap items-baseline gap-2 font-mono text-[11px]">
                    <span className="text-zavron-ink">{row.platform}</span>
                    {row.ok ? (
                      <span className="text-zavron-muted">
                        {row.calls} request{row.calls === 1 ? "" : "s"}
                      </span>
                    ) : (
                      <span className="text-[#fbbf24]">{previewReason(row.reason)}</span>
                    )}
                    {cost ? <span className="ml-auto text-zavron-ink">{cost}</span> : null}
                  </p>
                  {row.detail ? (
                    <p className="font-mono text-[10px] text-zavron-muted/70">{row.detail}</p>
                  ) : null}
                  {row.violations?.length ? (
                    <ul className="mt-1 space-y-0.5">
                      {row.violations.map((violation) => (
                        <li
                          key={`${row.variantId}-${violation.field}-${violation.message}`}
                          className="font-mono text-[10px] text-zavron-muted/70"
                        >
                          {violation.field} · {violation.level} · {violation.message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {row.notes.length > 0 ? (
                    <ul className="mt-1 space-y-0.5">
                      {row.notes.map((note) => (
                        <li
                          key={`${row.variantId}-${note}`}
                          className="text-[10px] leading-relaxed text-zavron-muted"
                        >
                          {note}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zavron-line/60 pt-3">
            <button
              type="button"
              onClick={() => void send()}
              className="rounded-md bg-zavron-accent px-3 py-1.5 text-sm font-medium text-zavron-bg0"
            >
              Send now
            </button>
            <button
              type="button"
              onClick={() => {
                setPreviews(null);
                setPhase("idle");
              }}
              className="rounded-md border border-zavron-line px-3 py-1.5 text-sm text-zavron-muted hover:text-zavron-ink"
            >
              Cancel
            </button>
            <span className="font-mono text-[10px] text-zavron-muted/70">
              approving and sending now · the estimate above is from the same flow
            </span>
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-2 font-mono text-[11px] text-[#f43f5e]">{error}</p> : null}

      {results ? (
        <ul className="mt-3 space-y-1" aria-live="polite">
          {results.map((outcome) => {
            const cost = costLabel(outcome.platform, outcome.estimatedCostUsd);
            return (
              <li key={outcome.platform} className="font-mono text-[11px]">
                <span className={verdictColor(outcome.verdict)}>{outcome.platform}</span>
                <span className="text-zavron-muted"> · {verdictCopy(outcome.verdict)}</span>
                {outcome.detail ? (
                  <span className="text-zavron-muted/70"> — {outcome.detail}</span>
                ) : null}
                {cost ? <span className="ml-2 text-zavron-ink">{cost}</span> : null}
                {outcome.url ? (
                  <a href={outcome.url} className="ml-2 underline decoration-zavron-line">
                    open
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function previewReason(reason: string | undefined): string {
  switch (reason) {
    case "not_connected":
      return "not connected";
    case "spec_blocked":
      return "blocked by the platform rules";
    case "not_found":
      return "variant not found";
    default:
      return reason ?? "cannot preview";
  }
}

/** `reauth_required` is not a failure at the platform — it is a credential a human must replace. */
function verdictCopy(verdict: string): string {
  return verdict === "reauth_required" ? "reconnect required" : verdict;
}

function verdictColor(verdict: string): string {
  switch (verdict) {
    case "published":
      return "text-[#5eead4]";
    case "failed":
    case "reapproval_required":
    case "spec_blocked":
      return "text-[#f43f5e]";
    case "awaiting_platform":
    case "not_connected":
    case "reauth_required":
      return "text-[#fbbf24]";
    default:
      return "text-zavron-ink";
  }
}
