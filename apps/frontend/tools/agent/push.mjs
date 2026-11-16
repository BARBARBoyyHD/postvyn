#!/usr/bin/env node
/**
 * Push a finished asset and its caption into Postvyn.
 *
 * This is the other half of "make me a video": the render finishes, the caption is written, and one
 * command turns both into a card on the board waiting for approval.
 *
 *   pnpm agent:push \
 *     --file D:/renders/teaser.mp4 \
 *     --title "Teaser — the file said 128" \
 *     --platform tiktok \
 *     --caption "The stock report said 128. The shelf said 92." \
 *     --hashtags "#inventory #ops" \
 *     --token pvt_xxx
 *
 * Reads POSTVYN_URL and POSTVYN_TOKEN from the environment when the flags are absent, so a shell that
 * already has them does not need to repeat them.
 *
 * Exit codes: 0 pushed · 1 refused by the server · 2 bad usage · 3 the draft is blocked by the spec rules.
 */
const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
};

const base = (flag("base") ?? process.env.POSTVYN_URL ?? "http://localhost:3001").replace(/\/$/, "");
const token = flag("token") ?? process.env.POSTVYN_TOKEN ?? "";
const file = flag("file");
const platform = flag("platform", "tiktok");
const caption = flag("caption", "");
const hashtags = (flag("hashtags", "") ?? "").split(/\s+/).filter(Boolean);
const title = flag("title") ?? (file ? file.split(/[\\/]/).pop() : "Untitled draft");
const pillar = flag("pillar");
const format = flag("format", "reel");

if (!file || !token) {
  console.error("usage: pnpm agent:push --file <path> --token <pvt_…> [--platform tiktok] [--caption …] [--hashtags …]");
  process.exit(2);
}

const { readFile } = await import("node:fs/promises");
const { basename } = await import("node:path");

const bytes = await readFile(file);
const filename = basename(file);

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

// 1. upload the asset
const upload = await fetch(`${base}/api/agent/media`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/octet-stream",
    "x-postvyn-filename": filename,
  },
  body: bytes,
});

const uploaded = await upload.json().catch(() => ({}));
if (!upload.ok || !uploaded.ok) {
  fail(`upload refused: ${upload.status} ${JSON.stringify(uploaded.error ?? uploaded)}`);
}

const mediaId = uploaded.result.mediaId;
console.log(`asset ${filename} → ${mediaId} (${Math.round(uploaded.result.bytes / 1024)} KB, ${uploaded.result.mime})`);

// 2. create the draft. The channel is named by platform — the caller knows "tiktok", not an id.
const target = flag("channel")
  ? { channelId: flag("channel") }
  : { platform };
const draft = await fetch(`${base}/api/agent/posts`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({
    title,
    format,
    pillar,
    targets: [{ ...target, caption, hashtags, mediaIds: [mediaId] }],
  }),
});

const created = await draft.json().catch(() => ({}));
if (!draft.ok || !created.ok) {
  if (draft.status === 422) {
    fail(`draft refused: ${JSON.stringify(created.detail ?? created.error)}`, 1);
  }
  fail(`draft refused: ${draft.status} ${JSON.stringify(created.error ?? created)}`);
}

const post = created.result;
console.log(`draft ${post.postId} · status ${post.status}`);
for (const target of post.targets) {
  const label = target.error ? `ERROR ${target.error}` : `${target.specState} · ${target.counted} chars`;
  console.log(`  ${target.platform.padEnd(10)} ${label}`);
  for (const issue of target.issues ?? []) {
    console.log(`    ${issue.level === "blocked" ? "✕" : "!"} ${issue.field}: ${issue.message}`);
  }
}

console.log(`open ${base}/posts/${post.postId}`);
if (post.targets.some((target) => target.specState === "blocked")) {
  console.error("the draft is on the board but blocked — fix the caption before approving");
  process.exit(3);
}
