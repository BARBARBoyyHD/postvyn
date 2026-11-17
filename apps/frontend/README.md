# Postvyn

Multi-profile publishing workspace. Next.js App Router, built for **Cloudflare Workers** via vinext
(ADR-016). Deploys to Workers + D1 + R2, not to Vercel.

This directory **is** the project. It owns its `pnpm-lock.yaml`, its `packageManager` pin and its
`onlyBuiltDependencies`; the repository root above it holds documents and `openspec/` only. The
Cloudflare Worker's build root points here, so the lockfile, the build and the deploy all happen in
one directory.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 22 | 24.x on the dev box |
| pnpm | **10.34.9** | pinned by `packageManager` in this `package.json` |

## Install

```bash
pnpm install
```

Run it here — there is no root `package.json` and no `pnpm-workspace.yaml`. CI uses
`pnpm install --frozen-lockfile`, which must never modify the lockfile. There is no `package-lock.json`
here and there should never be one.

## Run

```bash
pnpm dev           # next dev today, vite dev once `vinext init` has run
pnpm build
pnpm typecheck
pnpm lint
```

Scope-specific:

```bash
pnpm exec wrangler dev
pnpm exec wrangler d1 migrations apply postvyn-db --local
pnpm exec vinext check
```

## Two traps worth knowing before they cost an afternoon

**`LayoutProps` / `PageProps` are generated types in Next 16.** A bare `tsc --noEmit` fails on a clean
checkout and passes locally because `.next/` exists. The `typecheck` script runs `next typegen` first —
keep it that way.

**pnpm 10 blocks postinstall scripts.** `workerd` fetches its binary in its own postinstall; blocked,
`wrangler` will not start. The allowlist lives in this `package.json` under
`pnpm.onlyBuiltDependencies`. If wrangler dies with a missing-workerd error, that is what to check.

## Cache Components stay off

`next.config.ts` sets `cacheComponents: false` and `partialPrefetching: false` deliberately:
vinext supports them only partially, and `"use cache"` is the surface behind the October 2026 Next.js
RCE advisories. `create-next-app` enables both by default in Next 16 — re-enabling them is a PRD
change, not a config tweak.

No `turbopack.root` override is set. The pnpm store is `./node_modules/.pnpm`, inside the directory
Turbopack already treats as its filesystem root. That override only becomes necessary if this app ever
moves back into a workspace, where the store sits above it.

## Secrets

Every required variable is listed in `.env.example` with where its value comes from. Two rules that
matter more than the list:

**Nothing secret lives in `wrangler.jsonc`.** It declares binding *names* and non-secret vars only
(`PUBLISHING_ENABLED=false`, `R2_PUBLIC_BASE`). Real values go in `.env.local` for `pnpm dev` and
`.dev.vars` for `wrangler dev`; in production they are set with the platform's secret mechanism:

```bash
pnpm exec wrangler secret put BETTER_AUTH_SECRET
pnpm exec wrangler secret put TOKEN_ENCRYPTION_KEY
pnpm exec wrangler secret put RESEND_API_KEY
pnpm exec wrangler secret put CRON_SECRET
# uploads are signed client-side to R2's S3 endpoint, so the Worker needs an S3 key (M6)
pnpm exec wrangler secret put R2_ACCOUNT_ID
pnpm exec wrangler secret put R2_ACCESS_KEY_ID
pnpm exec wrangler secret put R2_SECRET_ACCESS_KEY
```

**`TOKEN_ENCRYPTION_KEY` is not a normal secret.** It decrypts every stored platform token. Losing it
turns every channel into `reauth_required`; rotating it is a `channel_credentials.key_version`
re-encrypt pass, not a replace-and-restart. Back it up somewhere that is not the D1 export bucket.

Platform credentials (Instagram, Threads, YouTube) are **not** environment variables at all — they are
entered in the app and stored encrypted in `channel_credentials`.

## Where the rest of the truth lives

| | |
|---|---|
| `../../AGENTS.md` | engineering standards, layout, non-negotiables |
| `../../docs/001-PRD.md` | scope contract |
| `../../docs/003-ITA.md` | stack, data model, API surface, 20 ADRs |
| `../../openspec/` | spec-driven changes; `m0-foundations` is the current one |

## The first user

Sign-up is public at `/register` and signs you in immediately — no verification email while mail
delivery is deferred. To create the first account on a fresh database, create it on the machine that
owns the database:

```bash
pnpm user:create you@example.com "Your Name"            # local D1
POSTVYN_PASSWORD='...' pnpm user:create you@example.com "Your Name" --remote
```

The password is generated and printed once unless `POSTVYN_PASSWORD` is set. The first account to sign
in adopts the seeded, memberless workspace as its owner — a solo tool seeds its tenant rather than
asking the first user to invent one.

## Getting an asset onto the board

Two doors, one intake: you with a file picker, and an agent with a token.

**Manual** — `/intake`, signed in: pick a file, write the caption, choose the channel. The draft lands in
`review` and nothing is approved by uploading.

**Agent** — mint a token once, then push a finished asset with its caption:

```bash
pnpm agent:token create --brand zavron --label hermes-reels   # prints pvt_… once
POSTVYN_TOKEN=pvt_… pnpm agent:push \
  --file D:/renders/teaser.mp4 \
  --title "Teaser - the file said 128" \
  --platform tiktok \
  --caption "The stock report said 128. The shelf said 92." \
  --hashtags "#inventory #ops"
```

It prints the post URL and the verdict per target, and exits `3` when the draft is blocked — so a script
that pushes a caption the platform would refuse fails loudly instead of leaving it on the board.

The token is scoped to one brand, stored as a SHA-256 hash, and resolves to `editor`: it can draft and
upload, and it cannot approve or publish. Revoke with `pnpm agent:token revoke --label hermes-reels`.

Uploads: 25 MB per file, MIME read from the bytes, SVG refused by policy, identical bytes stored once.
