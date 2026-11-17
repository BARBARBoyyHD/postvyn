"use client";

/**
 * Bulk approval, with every item answering for itself.
 *
 * The operator picks cards, picks one slot, and submits. The endpoint already resolves each item as an
 * outcome rather than an exception, so this component's job is honesty: a success is green and named,
 * a stale hash says "re-approve", and a spec block lists the rules the content breaks. Nothing here
 * decides whether something may publish.
 *
 * The hash is the one computed when the page was rendered. Sending it is what turns a concurrent edit
 * into `reapproval_required` instead of an approval of content the operator never saw.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { slotInputValue } from "@/lib/time";

export interface BulkApproveItem {
  variantId: string;
  postId: string;
  postTitle: string;
  platform: string;
  captionLength: number;
  specState: string;
  /** Computed from the content on screen; the server compares it before approving. */
  hash: string;
}

interface BatchOutcome {
  id: string;
  ok: boolean;
  error?: string;
  violations?: { field: string; level: string; message: string }[];
}

interface BatchResponse {
  ok?: boolean;
  error?: string;
  result?: {
    approved: number;
    failed: number;
    items: BatchOutcome[];
  };
}

export function BulkApprove({ items }: { items: BulkApproveItem[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [slot, setSlot] = useState(slotInputValue(null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<{
    approved: number;
    failed: number;
    rows: { label: string; outcome: BatchOutcome }[];
  } | null>(null);

  const allSelected = items.length > 0 && selected.size === items.length;

  function toggle(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(items.map((item) => item.variantId)));
  }

  async function submit() {
    const chosen = items.filter((item) => selected.has(item.variantId));
    if (chosen.length === 0 || !slot) return;

    setBusy(true);
    setError(null);
    setReport(null);

    let response: Response;
    try {
      response = await fetch("/api/v1/variants/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slotAt: new Date(slot).toISOString(),
          items: chosen.map((item) => ({ id: item.variantId, hash: item.hash })),
        }),
      });
    } catch {
      setBusy(false);
      setError("network error — nothing was approved");
      return;
    }
    const body = (await response.json().catch(() => ({}))) as BatchResponse;
    setBusy(false);

    if (!body.ok || !body.result) {
      setError(body.error ?? `could not approve (${response.status})`);
      return;
    }

    // Labels are captured now: a refresh removes approved cards from the server list, but the report
    // must still say which post each outcome belonged to.
    const labels = new Map(
      chosen.map((item) => [item.variantId, `${item.postTitle} · ${item.platform}`]),
    );
    setReport({
      approved: body.result.approved,
      failed: body.result.failed,
      rows: body.result.items.map((outcome) => ({
        label: labels.get(outcome.id) ?? outcome.id,
        outcome,
      })),
    });
    setSelected(new Set());
    router.refresh();
  }

  return (
    <div>
      {items.length === 0 ? (
        <p className="text-sm text-zavron-muted">Nothing waiting for approval.</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset>
            <legend className="sr-only">Variants waiting for approval</legend>
            <ul className="divide-y divide-zavron-line/60 border-y border-zavron-line/60">
              {items.map((item) => (
                <li key={item.variantId} className="flex items-start gap-3 py-3">
                  <input
                    id={item.variantId}
                    type="checkbox"
                    checked={selected.has(item.variantId)}
                    onChange={() => toggle(item.variantId)}
                    className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-zavron-accent)]"
                  />
                  <label htmlFor={item.variantId} className="min-w-0 flex-1 cursor-pointer">
                    <span className="block text-sm leading-snug text-zavron-ink">
                      {item.postTitle}
                    </span>
                    <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
                      {item.platform} · {item.captionLength} chars · spec {item.specState}
                    </span>
                  </label>
                  <Link
                    href={`/posts/${item.postId}`}
                    className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted transition-colors hover:text-zavron-ink"
                  >
                    open
                  </Link>
                </li>
              ))}
            </ul>
          </fieldset>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={toggleAll}
              className="rounded border border-zavron-line px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted transition-colors hover:text-zavron-ink"
            >
              {allSelected ? "clear selection" : "select all"}
            </button>

            <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
              slot
              <input
                type="datetime-local"
                value={slot}
                onChange={(event) => setSlot(event.target.value)}
                className="rounded border border-zavron-line bg-zavron-bg0/60 px-2 py-1 font-mono text-[11px] text-zavron-ink focus:border-zavron-accent focus:outline-none"
              />
            </label>

            <button
              type="submit"
              disabled={busy || selected.size === 0 || !slot}
              className="rounded bg-zavron-accent px-3 py-1.5 text-sm font-medium text-zavron-bg0 disabled:opacity-50"
            >
              {busy
                ? "approving…"
                : `approve ${selected.size} variant${selected.size === 1 ? "" : "s"}`}
            </button>

            <span className="font-mono text-[10px] text-zavron-muted/70">
              one slot for the selection · content is hashed per card
            </span>
          </div>

          {error ? (
            <p className="mt-3 font-mono text-[11px] text-[#f43f5e]" role="alert">
              {error}
            </p>
          ) : null}

          {selected.size > 0 && !slot ? (
            <p className="mt-3 font-mono text-[11px] text-[#fbbf24]">
              choose a slot before approving — approval never means publish-now.
            </p>
          ) : null}
        </form>
      )}

      {report ? (
        <div className="mt-5 border-t border-zavron-line/60 pt-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
            {report.approved} approved · {report.failed} not approved
          </p>
          <ul className="mt-2 space-y-2" aria-live="polite">
            {report.rows.map(({ label, outcome }) => (
              <li key={outcome.id}>
                <p className="text-sm">
                  <span className={outcome.ok ? "text-[#5eead4]" : "text-[#f43f5e]"}>
                    {outcome.ok ? "approved" : failureCopy(outcome.error)}
                  </span>
                  <span className="text-zavron-muted"> · {label}</span>
                </p>
                {outcome.violations?.length ? (
                  <ul className="mt-1 space-y-0.5">
                    {outcome.violations.map((violation) => (
                      <li
                        key={`${outcome.id}-${violation.field}-${violation.message}`}
                        className="font-mono text-[10px] text-zavron-muted"
                      >
                        {violation.field} · {violation.level} · {violation.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Named, not general: an operator needs to know which of four things went wrong. */
function failureCopy(error: string | undefined): string {
  switch (error) {
    case "reapproval_required":
      return "needs re-approval — the content changed after this list loaded";
    case "spec_blocked":
      return "blocked by the platform rules";
    case "not_found":
      return "not found in this workspace";
    case "internal_error":
      return "server error — try again";
    default:
      return "not approved";
  }
}
