"use client";

/**
 * The manual door: pick a file, write the caption, choose the channel.
 *
 * Two requests under one button — upload, then draft — because that is the real order and pretending
 * otherwise means uploading assets for drafts that never get created. The verdict comes back from the
 * server, which is also what the agent door gets.
 */
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { countFor } from "@/lib/specs/validate";
import type { Platform } from "@/lib/specs/platforms";

interface Channel {
  id: string;
  platform: string;
  accountRef: string | null;
  status: string;
}

export function IntakeForm({ channels }: { channels: Channel[] }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [postId, setPostId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const channel = channels.find((item) => item.id === channelId);
  const platform = (channel?.platform ?? "tiktok") as Platform;
  const tagList = useMemo(() => hashtags.split(/\s+/).filter(Boolean), [hashtags]);
  const count = useMemo(() => countFor(platform, caption, tagList), [platform, caption, tagList]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) {
      setMessage("choose a file first");
      return;
    }
    setBusy(true);
    setMessage(null);
    setPostId(null);

    // Three steps, because the bytes never touch the Worker: mint a URL, PUT the file to it, then ask
    // the server to record what landed (m6 1.1/1.2). The type the browser claims is only a hint —
    // the record step reads the bytes and refuses a mismatch.
    const minted = (await (
      await fetch("/api/v1/media", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, mime: file.type, bytes: file.size }),
      })
    ).json()) as {
      ok?: boolean;
      result?: { uploadId: string; url: string; mime: string };
      error?: string;
      detail?: unknown;
    };
    if (!minted.ok || !minted.result) {
      setBusy(false);
      setMessage(`upload refused: ${minted.error ?? "unknown"}`);
      return;
    }

    const put = await fetch(minted.result.url, {
      method: "PUT",
      headers: { "content-type": minted.result.mime },
      body: file,
    });
    if (!put.ok) {
      setBusy(false);
      setMessage(`storage refused the file: ${put.status} ${put.statusText}`);
      return;
    }

    const upload = await fetch(`/api/v1/media/${minted.result.uploadId}/record`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mime: minted.result.mime }),
    });
    const uploaded = (await upload.json()) as {
      ok?: boolean;
      result?: { mediaId: string };
      error?: string;
      detail?: unknown;
    };
    if (!upload.ok || !uploaded.result) {
      setBusy(false);
      setMessage(`upload refused: ${uploaded.error ?? upload.status}`);
      return;
    }

    const draft = await fetch("/api/v1/intake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: title || file.name,
        format: file.type.startsWith("video") ? "reel" : "single",
        targets: [
          {
            channelId,
            caption,
            hashtags: tagList,
            mediaIds: [uploaded.result.mediaId],
          },
        ],
      }),
    });
    const created = (await draft.json()) as {
      ok?: boolean;
      result?: { postId: string; targets: { specState: string; issues?: { field: string; message: string }[] }[] };
      error?: string;
    };

    setBusy(false);
    if (!draft.ok || !created.result) {
      setMessage(`draft refused: ${created.error ?? draft.status}`);
      return;
    }

    const target = created.result.targets[0];
    setPostId(created.result.postId);
    setMessage(
      target.specState === "blocked"
        ? `created, but blocked: ${target.issues?.map((issue) => issue.message).join("; ")}`
        : `created · ${target.specState} · ${count.counted} characters`,
    );
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
          asset
        </label>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          className="mt-1 block w-full cursor-pointer rounded-lg border border-zavron-line bg-zavron-bg1/60 px-3 py-2 text-sm text-zavron-muted file:mr-3 file:rounded file:border-0 file:bg-zavron-accent file:px-3 file:py-1 file:text-sm file:font-medium file:text-zavron-bg0"
        />
        <p className="mt-1 font-mono text-[10px] text-zavron-muted/70">
          25 MB max · PNG, JPEG, WebP, GIF, MP4, MOV · the type is read from the bytes, not the name
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
            title
          </label>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What this is, in one line"
            className="mt-1 w-full rounded-lg border border-zavron-line bg-zavron-bg1/60 px-3 py-2 text-sm text-zavron-ink placeholder:text-zavron-muted/60 focus:border-zavron-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
            channel
          </label>
          <select
            value={channelId}
            onChange={(event) => setChannelId(event.target.value)}
            className="mt-1 w-full rounded-lg border border-zavron-line bg-zavron-bg1/60 px-3 py-2 text-sm text-zavron-ink focus:border-zavron-accent focus:outline-none"
          >
            {channels.map((item) => (
              <option key={item.id} value={item.id}>
                {item.platform} {item.accountRef ? `@${item.accountRef}` : ""} · {item.status}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
          caption · {count.counted}
          {count.ceiling !== null ? ` / ${count.ceiling}` : ""}
        </label>
        <textarea
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          rows={6}
          placeholder="The hook is the first line — everything else is a reason to keep reading."
          className="mt-1 w-full resize-y rounded-lg border border-zavron-line bg-zavron-bg0/60 px-3 py-2 text-sm leading-relaxed text-zavron-ink placeholder:text-zavron-muted/60 focus:border-zavron-accent focus:outline-none"
        />
      </div>

      <div>
        <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
          hashtags
        </label>
        <input
          value={hashtags}
          onChange={(event) => setHashtags(event.target.value)}
          placeholder="#inventory #ops"
          className="mt-1 w-full rounded-lg border border-zavron-line bg-zavron-bg0/60 px-3 py-2 font-mono text-xs text-zavron-ink placeholder:text-zavron-muted/60 focus:border-zavron-accent focus:outline-none"
        />
      </div>

      {message ? (
        <p
          className={`font-mono text-[11px] ${
            message.includes("blocked") || message.includes("refused") ? "text-[#f43f5e]" : "text-[#5eead4]"
          }`}
        >
          {message}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || !file || channels.length === 0}
          className="rounded-md bg-zavron-accent px-4 py-2 text-sm font-medium text-zavron-bg0 disabled:opacity-50"
        >
          {busy ? "uploading…" : "Upload and create draft"}
        </button>
        {postId ? (
          <a
            href={`/posts/${postId}`}
            className="font-mono text-[11px] uppercase tracking-[0.14em] text-zavron-muted underline decoration-zavron-line hover:text-zavron-ink"
          >
            open the draft
          </a>
        ) : null}
      </div>
    </form>
  );
}
