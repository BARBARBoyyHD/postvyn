"use client";

/**
 * The human gate, in one control.
 *
 * Approving takes a slot, because an approval without a time is a decision nobody can schedule — and
 * defaulting to "now" would publish on approve, which the product promises never to do.
 *
 * The button is only rendered for an owner; the API refuses anyone else anyway, but a control that exists
 * and refuses teaches the operator to distrust the interface.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ApproveControl({
  variantId,
  status,
  slotAt,
}: {
  variantId: string;
  status: string;
  slotAt: number | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(defaultSlot(slotAt));
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isApproved = status === "scheduled" || status === "approved";

  async function approve() {
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/v1/variants/${variantId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotAt: new Date(value).toISOString() }),
    });
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setBusy(false);

    if (!body.ok) {
      setMessage(body.error ?? "could not approve");
      return;
    }
    setMessage("approved");
    router.refresh();
  }

  async function revoke() {
    setBusy(true);
    const response = await fetch(`/api/v1/variants/${variantId}/approve`, { method: "DELETE" });
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setBusy(false);
    if (!body.ok) {
      setMessage(body.error ?? "could not revoke");
      return;
    }
    setMessage("back to review");
    router.refresh();
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zavron-line/60 pt-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
        {isApproved ? "approved for" : "approve for"}
      </span>
      <input
        type="datetime-local"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="rounded border border-zavron-line bg-zavron-bg0/60 px-2 py-1 font-mono text-[11px] text-zavron-ink focus:border-zavron-accent focus:outline-none"
      />
      <button
        type="button"
        onClick={() => void approve()}
        disabled={busy || !value}
        className="rounded bg-zavron-accent px-2.5 py-1 text-[11px] font-medium text-zavron-bg0 disabled:opacity-50"
      >
        {isApproved ? "re-approve" : "approve"}
      </button>
      {isApproved ? (
        <button
          type="button"
          onClick={() => void revoke()}
          disabled={busy}
          className="rounded border border-zavron-line px-2.5 py-1 text-[11px] text-zavron-muted hover:text-zavron-ink"
        >
          revoke
        </button>
      ) : null}
      {message ? <span className="font-mono text-[10px] text-zavron-muted">{message}</span> : null}
      <span className="ml-auto font-mono text-[10px] text-zavron-muted/60">
        owner only · the content is hashed at approval
      </span>
    </div>
  );
}

/** Tomorrow at 09:00 local, which is the answer nine times out of ten. */
function defaultSlot(existing: number | null): string {
  const date = existing ? new Date(existing) : tomorrowAtNine();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function tomorrowAtNine(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date;
}
