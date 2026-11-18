"use client";

/**
 * Revoke a channel's credentials.
 *
 * Two steps on purpose: the first click only asks. Disconnecting deletes the credential row and leaves
 * the channel and its publish history in place — revoking access is not erasing what was published.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ChannelDisconnect({ channelId, label }: { channelId: string; label: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/channels?id=${encodeURIComponent(channelId)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setError(disconnectError(response.status));
        setConfirming(false);
        return;
      }
      setConfirming(false);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-wrap items-baseline gap-3">
      {confirming ? (
        <>
          <span className="font-mono text-[10px] text-[#fbbf24]">
            disconnect? credentials are revoked; published history stays
          </span>
          <button
            type="button"
            onClick={() => void disconnect()}
            disabled={busy}
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#f43f5e] disabled:opacity-50"
          >
            {busy ? "disconnecting…" : "yes, disconnect"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted hover:text-zavron-ink"
          >
            cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={`disconnect ${label}`}
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted hover:text-zavron-ink"
        >
          disconnect
        </button>
      )}

      {error ? (
        <span role="alert" className="font-mono text-[10px] text-[#f43f5e]">
          {error}
        </span>
      ) : null}
    </span>
  );
}

function disconnectError(status: number): string {
  if (status === 401) return "your session expired — reload and sign in again.";
  if (status === 403) return "only an owner can disconnect a channel.";
  if (status === 404) return "nothing to revoke — the channel is gone or has no stored credentials.";
  if (status === 422) return "the request was missing its channel id.";
  return `the request failed (${status}).`;
}
