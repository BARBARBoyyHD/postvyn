"use client";

/**
 * The editor for one variant.
 *
 * Four behaviours worth naming:
 *
 * 1. **Autosave after 5 s idle, with a revision.** Every write carries the revision the client believes
 *    it is writing over; the server refuses an older one with `409 stale_write`. A slow in-flight save
 *    then cannot undo newer typing — the failure mode nobody notices until they lose a paragraph.
 * 2. **Counting is client-side, the verdict is not.** The counter uses the same module the server
 *    validates with. What gets stored is the server's answer, and that is what the panel shows.
 * 3. **Warnings need a reason.** A block is an edit waiting to happen; a warning is a judgement, so
 *    accepting one records who accepted it and why.
 * 4. **Media is by id, in order.** Reordering a carousel is a different post, so the order is part of the
 *    content, not a display preference.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { countFor } from "@/lib/specs/validate";
import type { Platform } from "@/lib/specs/platforms";

interface Issue {
  field: string;
  level: "warn" | "blocked";
  message: string;
}

interface MediaItem {
  id: string;
  mime: string;
  bytes: number;
}

interface ChannelOption {
  id: string;
  platform: string;
  accountRef: string | null;
}

const AUTOSAVE_MS = 5000;

type SaveStatus = "idle" | "typing" | "saving" | "saved" | "stale" | "error";

const STATUS_COPY: Record<SaveStatus, string> = {
  idle: "autosave on",
  typing: "typing…",
  saving: "saving…",
  saved: "saved",
  stale: "newer version on the server — reload",
  error: "save failed — retry",
};

export function VariantEditor({
  variantId,
  platform,
  channelStatus,
  initialCaption,
  initialHashtags,
  initialMediaIds,
  initialRevision,
  hashtagPlacement,
  voice,
  media,
  otherChannels,
}: {
  variantId: string;
  platform: Platform;
  channelStatus: string;
  initialCaption: string;
  initialHashtags: string[];
  initialMediaIds: string[];
  initialRevision: number;
  hashtagPlacement: "caption" | "first_comment";
  voice: string | null;
  media: MediaItem[];
  otherChannels: ChannelOption[];
}) {
  const router = useRouter();
  const [caption, setCaption] = useState(initialCaption);
  const [hashtags, setHashtags] = useState(initialHashtags.join(" "));
  const [mediaIds, setMediaIds] = useState(initialMediaIds);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [state, setState] = useState("unchecked");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [overrideFor, setOverrideFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [duplicateTo, setDuplicateTo] = useState(otherChannels[0]?.id ?? "");

  const revision = useRef(initialRevision);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tagList = useMemo(() => hashtags.split(/\s+/).filter(Boolean), [hashtags]);
  const count = useMemo(() => countFor(platform, caption, tagList), [platform, caption, tagList]);
  const over = count.remaining !== null && count.remaining < 0;

  const save = useCallback(
    async (payload?: { acceptWarning: { field: string; key: string; reason: string } }) => {
      setStatus("saving");
      const response = await fetch(`/api/v1/variants/${variantId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          payload?.acceptWarning
            ? { acceptWarning: payload.acceptWarning }
            : { caption, hashtags: tagList, mediaIds, revision: revision.current },
        ),
      });

      if (response.status === 409) {
        setStatus("stale");
        return;
      }

      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: { specState?: string; issues?: Issue[]; revision?: number };
      };
      if (!body.ok || !body.result) {
        setStatus("error");
        return;
      }

      if (typeof body.result.revision === "number") revision.current = body.result.revision;
      if (body.result.specState) setState(body.result.specState);
      setIssues(body.result.issues ?? []);
      dirty.current = false;
      setStatus("saved");
    },
    [caption, mediaIds, tagList, variantId],
  );

  // Debounced autosave: the timer resets on every keystroke, so a fast typist writes once, not fifty
  // times — and an idle editor writes nothing at all.
  useEffect(() => {
    if (!dirty.current) return;
    setStatus("typing");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [caption, hashtags, mediaIds, save]);

  function touch() {
    dirty.current = true;
  }

  function move(mediaId: string, direction: -1 | 1) {
    setMediaIds((current) => {
      const index = current.indexOf(mediaId);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= current.length) return current;
      const copy = [...current];
      [copy[index], copy[next]] = [copy[next], copy[index]];
      return copy;
    });
    touch();
  }

  function toggleMedia(mediaId: string) {
    setMediaIds((current) =>
      current.includes(mediaId) ? current.filter((id) => id !== mediaId) : [...current, mediaId],
    );
    touch();
  }

  async function accept(issue: Issue) {
    if (reason.trim().length < 4) return;
    await save({ acceptWarning: { field: issue.field, key: issue.message, reason: reason.trim() } });
    setOverrideFor(null);
    setReason("");
  }

  async function duplicate() {
    if (!duplicateTo) return;
    await fetch(`/api/v1/variants/${variantId}/duplicate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channelId: duplicateTo }),
    });
    router.refresh();
  }

  const stateColor =
    state === "ok"
      ? "text-[#5eead4]"
      : state === "warn"
        ? "text-[#fbbf24]"
        : state === "blocked"
          ? "text-[#f43f5e]"
          : "text-zavron-muted";

  return (
    <section className="rounded-xl border border-zavron-line bg-zavron-bg1/40">
      <header className="flex flex-wrap items-center gap-3 border-b border-zavron-line px-4 py-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-brand-accent">
          {platform}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
          {channelStatus}
        </span>
        <span className="ml-auto flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.14em]">
          <span className={over ? "text-[#f43f5e]" : "text-zavron-muted"}>
            {count.counted}
            {count.ceiling !== null ? ` / ${count.ceiling}` : ""}
            {count.unit === "bytes" ? " · bytes" : ""}
          </span>
          <span className={`uppercase ${stateColor}`}>{state.replace("_", " ")}</span>
          <span className="text-zavron-muted/70">{STATUS_COPY[status]}</span>
        </span>
      </header>

      <div className="grid gap-4 px-4 py-4 lg:grid-cols-[1fr_260px]">
        <div>
          <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
            caption
          </label>
          <textarea
            value={caption}
            onChange={(event) => {
              setCaption(event.target.value);
              touch();
            }}
            rows={9}
            spellCheck
            placeholder="The first line is the hook — it decides whether the platform truncates you."
            className="mt-1 w-full resize-y rounded-lg border border-zavron-line bg-zavron-bg0/60 px-3 py-2 text-sm leading-relaxed text-zavron-ink placeholder:text-zavron-muted/60 focus:border-zavron-accent focus:outline-none"
          />

          <label className="mt-3 block font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
            hashtags {hashtagPlacement === "first_comment" ? "· goes to the first comment" : "· inline"}
          </label>
          <input
            value={hashtags}
            onChange={(event) => {
              setHashtags(event.target.value);
              touch();
            }}
            placeholder="#zavron #webdevelopment"
            className="mt-1 w-full rounded-lg border border-zavron-line bg-zavron-bg0/60 px-3 py-2 font-mono text-xs text-zavron-ink placeholder:text-zavron-muted/60 focus:border-zavron-accent focus:outline-none"
          />

          {issues.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {issues.map((issue) => (
                <li key={`${issue.field}-${issue.message}`} className="text-[11px]">
                  <span
                    className={`font-mono ${issue.level === "blocked" ? "text-[#f43f5e]" : "text-[#fbbf24]"}`}
                  >
                    {issue.level === "blocked" ? "✕" : "!"} {issue.field}: {issue.message}
                  </span>

                  {issue.level === "warn" ? (
                    overrideFor === issue.message ? (
                      <span className="mt-1 flex items-center gap-2">
                        <input
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                          placeholder="why is this acceptable?"
                          className="flex-1 rounded border border-zavron-line bg-zavron-bg0/60 px-2 py-1 text-[11px] text-zavron-ink placeholder:text-zavron-muted/60 focus:border-zavron-accent focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => void accept(issue)}
                          disabled={reason.trim().length < 4}
                          className="rounded bg-zavron-accent px-2 py-1 text-[11px] font-medium text-zavron-bg0 disabled:opacity-50"
                        >
                          accept
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setOverrideFor(issue.message)}
                        className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted underline decoration-zavron-line hover:text-zavron-ink"
                      >
                        accept with a reason
                      </button>
                    )
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {over ? (
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-[#f43f5e]">
              {Math.abs(count.remaining ?? 0)} over — the platform will refuse this
            </p>
          ) : null}

          {voice ? (
            <p className="mt-4 border-l-2 border-zavron-line pl-3 text-[11px] leading-relaxed text-zavron-muted">
              <span className="font-mono uppercase tracking-[0.14em]">voice</span> · {voice}
            </p>
          ) : null}
        </div>

        <aside>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
            media · {mediaIds.length}
          </p>
          <ol className="mt-1 space-y-1">
            {mediaIds.map((id, index) => {
              const item = media.find((row) => row.id === id);
              return (
                <li
                  key={id}
                  className="flex items-center gap-1 rounded border border-zavron-line/70 px-1.5 py-1 font-mono text-[10px] text-zavron-muted"
                >
                  <span className="text-zavron-ink">{index + 1}</span>
                  <span className="truncate">
                    {item
                      ? `${item.mime.replace("image/", "")} · ${Math.max(1, Math.round(item.bytes / 1024))} KB`
                      : id}
                  </span>
                  <span className="ml-auto flex gap-0.5">
                    <button type="button" onClick={() => move(id, -1)} className="px-1 hover:text-zavron-ink" aria-label="move up">
                      ↑
                    </button>
                    <button type="button" onClick={() => move(id, 1)} className="px-1 hover:text-zavron-ink" aria-label="move down">
                      ↓
                    </button>
                    <button type="button" onClick={() => toggleMedia(id)} className="px-1 hover:text-[#f43f5e]" aria-label="detach">
                      ×
                    </button>
                  </span>
                </li>
              );
            })}
            {mediaIds.length === 0 ? (
              <li className="font-mono text-[10px] text-zavron-muted/60">nothing attached</li>
            ) : null}
          </ol>

          {media.filter((item) => !mediaIds.includes(item.id)).length > 0 ? (
            <>
              <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted/70">
                library
              </p>
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
                {media
                  .filter((item) => !mediaIds.includes(item.id))
                  .map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => toggleMedia(item.id)}
                        className="w-full truncate rounded px-1.5 py-1 text-left font-mono text-[10px] text-zavron-muted hover:bg-zavron-bg1/60 hover:text-zavron-ink"
                      >
                        + {item.mime.replace("image/", "")} · {Math.max(1, Math.round(item.bytes / 1024))} KB
                      </button>
                    </li>
                  ))}
              </ul>
            </>
          ) : null}

          {otherChannels.length > 0 ? (
            <div className="mt-4 border-t border-zavron-line pt-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
                duplicate to
              </p>
              <div className="mt-1 flex gap-1">
                <select
                  value={duplicateTo}
                  onChange={(event) => setDuplicateTo(event.target.value)}
                  className="min-w-0 flex-1 rounded border border-zavron-line bg-zavron-bg1/60 px-1.5 py-1 text-[11px] text-zavron-ink"
                >
                  {otherChannels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channel.platform}
                      {channel.accountRef ? ` @${channel.accountRef}` : ""}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void duplicate()}
                  className="rounded border border-zavron-line px-2 py-1 text-[11px] text-zavron-ink hover:border-zavron-accent"
                >
                  copy
                </button>
              </div>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => void save()}
            className="mt-4 w-full rounded-md bg-zavron-accent px-3 py-1.5 text-sm font-medium text-zavron-bg0"
          >
            Save now
          </button>
        </aside>
      </div>
    </section>
  );
}
