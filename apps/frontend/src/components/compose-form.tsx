"use client";

/**
 * Create a post and its variants in one step.
 *
 * Two calls, in order, because a post with no variants is not a draft anyone can act on: create the
 * post, then add one variant per selected channel, then go straight to the editor. If a variant fails
 * the post still exists — the message says which channel failed rather than pretending nothing happened.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

interface Channel {
  id: string;
  platform: string;
  accountRef: string | null;
  status: string;
}

export function ComposeForm({ brandId, channels }: { brandId: string; channels: Channel[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState("single");
  const [pillar, setPillar] = useState("");
  const [selected, setSelected] = useState<string[]>(channels.slice(0, 1).map((c) => c.id));
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);

    const createdPost = await fetch("/api/v1/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brandId, title, format, pillar: pillar || null }),
    });
    const postBody = (await createdPost.json()) as { ok?: boolean; result?: { id: string }; error?: string };

    if (!postBody.ok || !postBody.result) {
      setBusy(false);
      setMessage(postBody.error ?? "could not create the post");
      return;
    }

    const failures: string[] = [];
    for (const channelId of selected) {
      const response = await fetch(`/api/v1/posts/${postBody.result.id}/variants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId }),
      });
      if (!response.ok) failures.push(channelId.slice(0, 8));
    }

    if (failures.length > 0) setMessage(`variant failed for: ${failures.join(", ")}`);
    router.push(`/posts/${postBody.result.id}/edit`);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
          title
        </label>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          minLength={3}
          maxLength={160}
          placeholder="What is this post about, in one line"
          className="mt-1 w-full rounded-lg border border-zavron-line bg-zavron-bg1/60 px-3 py-2 text-sm text-zavron-ink placeholder:text-zavron-muted/60 focus:border-zavron-accent focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
            format
          </label>
          <select
            value={format}
            onChange={(event) => setFormat(event.target.value)}
            className="mt-1 w-full rounded-lg border border-zavron-line bg-zavron-bg1/60 px-3 py-2 text-sm text-zavron-ink focus:border-zavron-accent focus:outline-none"
          >
            <option value="single">single</option>
            <option value="carousel">carousel</option>
            <option value="reel">reel</option>
            <option value="text">text</option>
          </select>
        </div>
        <div>
          <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
            pillar
          </label>
          <input
            value={pillar}
            onChange={(event) => setPillar(event.target.value)}
            placeholder="authority · proof · offer"
            className="mt-1 w-full rounded-lg border border-zavron-line bg-zavron-bg1/60 px-3 py-2 text-sm text-zavron-ink placeholder:text-zavron-muted/60 focus:border-zavron-accent focus:outline-none"
          />
        </div>
      </div>

      <fieldset>
        <legend className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
          channels — one variant each
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {channels.map((channel) => (
            <label
              key={channel.id}
              className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm ${
                selected.includes(channel.id)
                  ? "border-zavron-accent text-zavron-ink"
                  : "border-zavron-line text-zavron-muted"
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={selected.includes(channel.id)}
                onChange={() => toggle(channel.id)}
              />
              {channel.platform}
              {channel.accountRef ? (
                <span className="ml-1 font-mono text-[10px] text-zavron-muted">@{channel.accountRef}</span>
              ) : null}
            </label>
          ))}
          {channels.length === 0 ? (
            <p className="text-sm text-zavron-muted">
              No channels on this brand yet — connect one before composing.
            </p>
          ) : null}
        </div>
      </fieldset>

      {message ? (
        <p className="font-mono text-[11px] text-[#f43f5e]">{message}</p>
      ) : null}

      <button
        type="submit"
        disabled={busy || !title.trim()}
        className="rounded-md bg-zavron-accent px-4 py-2 text-sm font-medium text-zavron-bg0 disabled:opacity-50"
      >
        {busy ? "creating…" : "Create draft"}
      </button>
    </form>
  );
}
