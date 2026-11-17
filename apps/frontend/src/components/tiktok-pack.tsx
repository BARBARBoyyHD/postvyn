"use client";

/**
 * The TikTok pack, on demand.
 *
 * TikTok never reaches an API from here (non-negotiable 5), so this control is the upload: it fetches
 * what a human needs — caption, hashtags, assets in publish order, the checklist and the guideline
 * reason — and then records the post's URL once they have done it by hand.
 *
 * Pack reads are for anyone in the workspace; recording completion is owner-only, the same gate the
 * API enforces, so the form is not drawn for editors rather than drawn and refused.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

interface Pack {
  caption: string;
  hashtags: string[];
  assets: { mediaId: string; kind: string; path: string; url: string | null }[];
  checklist: string[];
  reason: string;
}

type PackState = "idle" | "loading" | "ready" | "error";

export function TiktokPack({
  variantId,
  canComplete,
  published,
}: {
  variantId: string;
  canComplete: boolean;
  published: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<PackState>("idle");
  const [pack, setPack] = useState<Pack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<string | null>(null);

  async function load() {
    setState("loading");
    setError(null);

    const response = await fetch(`/api/v1/variants/${variantId}/tiktok-pack`).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: { pack?: Pack };
      error?: string;
    } | null;

    if (!response || !body?.ok || !body.result?.pack) {
      setState("error");
      setError(
        body?.error === "not_tiktok"
          ? "this variant is not a TikTok target"
          : `${body?.error ?? "could not load the pack"} (${response?.status ?? "network"})`,
      );
      return;
    }

    setPack(body.result.pack);
    setState("ready");
  }

  async function complete() {
    setBusy(true);
    setCompletionError(null);

    const response = await fetch(`/api/v1/variants/${variantId}/tiktok-complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: { url?: string };
      error?: string;
    } | null;
    setBusy(false);

    if (!response || !body?.ok) {
      setCompletionError(completionErrorCopy(body?.error, response?.status));
      return;
    }

    setRecorded(body.result?.url ?? url);
    setUrl("");
    router.refresh();
  }

  if (state === "idle") {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-zavron-line/60 pt-3">
        <button
          type="button"
          onClick={() => void load()}
          className="rounded border border-zavron-line px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted transition-colors hover:text-zavron-ink"
        >
          Get pack
        </button>
        <span className="font-mono text-[10px] text-zavron-muted/60">
          posted by hand — nothing is sent to TikTok
        </span>
      </div>
    );
  }

  if (state === "loading") {
    return (
      <p className="mt-3 border-t border-zavron-line/60 pt-3 font-mono text-[10px] text-zavron-muted">
        loading the pack…
      </p>
    );
  }

  if (state === "error") {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-zavron-line/60 pt-3">
        <p role="alert" className="font-mono text-[10px] text-[#f43f5e]">
          {error}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded border border-zavron-line px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted hover:text-zavron-ink"
        >
          retry
        </button>
      </div>
    );
  }

  if (!pack) return null;

  return (
    <div className="mt-3 border-t border-zavron-line/60 pt-3">
      <div className="rounded-lg border border-zavron-line bg-zavron-bg0/40 px-3 py-3">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-zavron-ink">
          {pack.caption || <span className="text-zavron-muted">empty caption</span>}
        </p>

        {pack.hashtags.length > 0 ? (
          <p className="mt-2 font-mono text-xs leading-relaxed text-zavron-muted">
            {pack.hashtags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).join(" ")}
          </p>
        ) : null}

        {pack.assets.length > 0 ? (
          <ol className="mt-3 space-y-1">
            {pack.assets.map((asset, index) => (
              <li
                key={asset.mediaId}
                className="flex flex-wrap items-center gap-2 rounded border border-zavron-line/60 px-2 py-1 font-mono text-[10px] text-zavron-muted"
              >
                <span className="text-zavron-ink">{index + 1}</span>
                <span className="uppercase tracking-[0.14em]">{asset.kind}</span>
                <span className="min-w-0 flex-1 truncate" title={asset.path}>
                  {asset.path}
                </span>
                {asset.url ? (
                  <a
                    href={asset.url}
                    className="shrink-0 text-zavron-ink underline decoration-zavron-line underline-offset-2"
                  >
                    public url
                  </a>
                ) : (
                  <span className="shrink-0 text-zavron-muted/70">stored path only</span>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 font-mono text-[10px] text-zavron-muted">No assets — text post.</p>
        )}

        <ol className="mt-3 space-y-1 text-sm leading-relaxed text-zavron-muted">
          {pack.checklist.map((step, index) => (
            <li key={step} className="flex gap-2">
              <span className="font-mono text-[10px] text-zavron-ink">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        <p className="mt-3 border-t border-zavron-line/60 pt-2 font-mono text-[10px] leading-relaxed text-zavron-muted/80">
          {pack.reason}
        </p>
      </div>

      {canComplete && !published ? (
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void complete();
          }}
        >
          <label
            htmlFor={`tiktok-url-${variantId}`}
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted"
          >
            post url
          </label>
          <input
            id={`tiktok-url-${variantId}`}
            type="url"
            required
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://www.tiktok.com/@account/video/…"
            className="min-w-0 flex-1 rounded border border-zavron-line bg-zavron-bg0/60 px-2 py-1 font-mono text-[11px] text-zavron-ink placeholder:text-zavron-muted focus:border-zavron-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !url}
            className="rounded bg-zavron-accent px-2.5 py-1 text-[11px] font-medium text-zavron-bg0 disabled:opacity-50"
          >
            {busy ? "recording…" : "Mark posted"}
          </button>
          <span className="font-mono text-[10px] text-zavron-muted/60">
            owner only · a manual record, not an API read-back
          </span>
        </form>
      ) : null}

      {completionError ? (
        <p role="alert" className="mt-2 font-mono text-[10px] text-[#f43f5e]">
          {completionError}
        </p>
      ) : null}

      {recorded ? (
        <p className="mt-2 font-mono text-[10px] text-[#5eead4]">
          recorded ·{" "}
          <a href={recorded} className="underline decoration-zavron-line underline-offset-2">
            {recorded}
          </a>
        </p>
      ) : null}
    </div>
  );
}

/** Named per refusal, because each one is a different thing the operator has to do next. */
function completionErrorCopy(error: string | undefined, status: number | undefined): string {
  switch (error) {
    case "already_published":
      return "already recorded — one success per variant.";
    case "reapproval_required":
      return "the content changed after it was approved — re-approve it before recording this post.";
    case "archived":
      return "this post is archived; an archived post cannot be marked posted.";
    case "invalid_completion":
      return "enter the post's URL, starting with http:// or https://.";
    case "not_tiktok":
      return "this variant is not a TikTok target.";
    case "forbidden":
      return "only an owner can record manual completion.";
    default:
      return `${error ?? "could not record the post"} (${status ?? "network"})`;
  }
}
