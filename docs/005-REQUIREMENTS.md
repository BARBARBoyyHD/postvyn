---
title: Requirements Gathering — Postvyn
type: spec
doc: requirements
project: postvyn
status: draft
updated: 2026-11-17
tags: [postvyn, spec, requirements]
aliases: [REQUIREMENTS, 005]
---

# Requirements Gathering — Postvyn

**Version:** 0.1
**Date:** 2026-Nov-15
**Status:** Draft — blocking M0
**Derived from:** PRD v0.1 (§8 platform constraints), ITA v0.1 (§6 integrations, §7 secrets, §9 envs)

---

## 1. How to use this document

Everything that must exist **before** M0 starts, split into what only you can do (create accounts,
grant permissions, hand over data) and what I do once the values exist.

Rules for secrets:

- **Never paste a key, token or password into chat.** Not to me, not in a Telegram message.
- Put values in `D:/project/nextjs/postvyn/.env.local` (gitignored from the first commit) and
  tell me it is filled. I read files, not DMs.
- Production values live in the host's secret store. Same keys, different values.

Blocking legend: **M0** = cannot start · **M1** = cannot finish identity · **M5** = cannot ship.

---

## 2. Platform accounts & credentials

### 2.1 Instagram (Meta)

| Item | Detail |
|---|---|
| What to create | A **Meta app** of type *Business* at `developers.facebook.com` → add the *Instagram* product with **Instagram API with Instagram Login** (not Facebook Login — no Page required) |
| Permissions to request | `instagram_business_basic`, `instagram_business_content_publish` |
| Account requirement | The Instagram account must be **Business or Creator**. Personal accounts cannot be published to at all. |
| Access level | **Standard Access** — correct and sufficient while the app only serves accounts you own. **No App Review needed.** |
| App mode | Development mode is fine while only your accounts are connected; going *Live* requires a Privacy Policy URL, Terms URL and data-deletion instructions (see §8) |
| Values I need | `IG_APP_ID`, `IG_APP_SECRET`, `IG_USER_ID`, `IG_TOKEN` (long-lived, ~60 days) |
| Expiry | Long-lived token ~60 days → the app refreshes it from cron; a dead token shows as `reauth_required` |
| Wrong grabs to avoid | Facebook Login variant (drags in a Page), a Page access token instead of an Instagram user token, a short-lived token (exchange it first) |
| Several accounts? | Each Instagram account is its own **channel** with its own token. The schema allows many channels per brand per platform (ADR-012), so a second account is a new connection, not a second workspace |
| Blocks | M5 |

### 2.2 Threads (Meta — same app)

| Item | Detail |
|---|---|
| What to create | In the same Meta app, add the **Threads** product. Then add your Threads account as a **Threads Tester**. |
| Permissions | `threads_basic`, `threads_content_publish` |
| Access level | Tester access — **no App Review** for your own account. 250 published posts / 24 h. |
| Values I need | `THREADS_USER_ID`, `THREADS_TOKEN` |
| Expiry | ~60 days, refreshable |
| Blocks | M5 |

### 2.3 X (Twitter) — removed from the product (2026-11-17)

> **Superseded.** X left the platform lineup on 2026-11-17: no adapter, no credits, no connect path
> ships. **Do not create the X developer account and do not buy credits.** The rows below are kept
> for history only. Decision record: `docs/001-PRD.md` §5/§8; the show-before-spend principle now
> applies to YouTube quota (§2.5).

| Item | Detail |
|---|---|
| What to create | An X **developer account** → project → app with **OAuth 1.0a user context**, permissions **Read and Write** |
| Critical detail | Permissions are set at app creation. Changing them later forces key regeneration — set *Read and Write* first time |
| Billing | Pay-per-use since Feb 2026: **$0.015 per post, $0.20 when it contains a link.** Buy credits and set a spending cap. |
| Values I need | `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` |
| Expiry | Keys are long-lived (rotate manually); credits are not — a zero balance returns HTTP 402 |
| Blocks | M5 — **or never**, if you choose manual (§6 D1) — *moot: X removed 2026-11-17* |

### 2.4 TikTok

| Item | Detail |
|---|---|
| Credentials needed | **None.** There is no publishing integration (ADR-008). |
| What you do | Upload via TikTok's own in-app scheduler from the generated pack: one manual step per video, batchable weekly |
| Why | Their Content Sharing Guidelines name "a utility tool to help upload contents to the account(s) you or your team manages" as unacceptable, and unaudited clients post private-only |
| Optional | A TikTok Business account, if you want the in-app analytics you will be reading anyway |

### 2.5 YouTube (Google)

| Item | Detail |
|---|---|
| What to create | A **Google Cloud project** → enable **YouTube Data API v3** → OAuth consent screen (External) → **publish it to "In production"** → OAuth client, then run the consent flow once outside the app (OAuth Playground or the client's own redirect) to get a refresh token |
| Critical detail | A consent screen left in **Testing** issues refresh tokens that die in **7 days** (Google OAuth2 doc, read 2026-11-17). Publishing to production fixes it; the "unverified app" warning is expected and harmless for a one-operator tool |
| Values I need | **none in `.env`** — `clientId`, `clientSecret` and `refreshToken` are entered in the app per channel (ADR-011/012), exactly like Instagram and Threads (§5) |
| Expiry | access tokens ~1 h, minted at publish time; refresh tokens are durable in production but die if revoked, unused ~6 months, or the consent screen slips back to Testing — the monthly exercise pass surfaces all three as `reauth_required` |
| Quota | default **100 `videos.insert`/day** (own bucket) + **10,000 general units/day**, reset midnight Pacific (Quota Calculator, read 2026-11-17) — shown before every upload; the Console quota page is the authority |
| Blocks | `platform-swap-youtube` (the change that swaps X out and YouTube in) |

---

## 3. Infrastructure services

| Service | Purpose | Free tier reality | Values I need | Blocks |
|---|---|---|---|---|
| **Cloudflare account** | Workers + **D1** + R2 + Cron | free tier covers this workload | `CLOUDFLARE_ACCOUNT_ID`; D1 database id in `wrangler.jsonc` | M0 |
| **Cloudflare R2** | media hosting (platforms fetch URLs) | 10 GB free, zero egress | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE` | M5 (M0 if you want the upload path early) |
| **GitHub** | repo + CI | free | repo URL, push access | M0 |
| **Hosting** | Worker (UI + API) + cron trigger | Workers **free** plan fits the JSON API; **$5 Paid** if SSR blows the 10 ms CPU budget | `wrangler login` / API token for CI | M5 |
| **Resend** | transactional email: verification, reset, publish-failure alerts | free: **3,000/mo, 100/day** (UTC day, hard cap, no overage), 3 domains, 1 webhook | `RESEND_API_KEY`, `EMAIL_FROM` | M1 |
| **Cloudflare Turnstile** | signup/reset bot defence | free | site key + secret key | M1 |

**R2 setup detail that bites:** create the bucket, then a token with **Object Read & Write scoped
to that bucket**, and enable public read through a **custom domain** (the `r2.dev` subdomain is
rate-limited and unsuitable for platforms that fetch media). Browser uploads need a CORS rule
allowing `PUT` from the app's origin.

**Email sending domain — do this before any auth email works.** Resend needs a **verified domain**,
not just an API key. Use a subdomain (`mail.<yourdomain>`) so a reputation hit cannot touch the root
domain, then add the records Resend shows you:

| Record | Purpose |
|---|---|
| SPF (`TXT`) | authorises Resend to send on behalf of the domain |
| DKIM (`TXT`, one or more) | signs the mail so inboxes don't treat it as forged |
| DMARC (`TXT` at `_dmarc`) | tells inboxes what to do when SPF/DKIM fail — **without this, password resets land in spam** |
| MX *(optional)* | only if you want bounces or replies delivered somewhere |

Start DMARC at `p=none` with a reporting address, then tighten to `quarantine` once the reports look
clean. One DNS session, once — and it is the difference between a working reset flow and a
support-ticket generator.

---

## 4. Local toolchain — verified on this machine (2026-Nov-15)

| Tool | Status | Note |
|---|---|---|
| Node | ✅ `v24.11.1` at `D:/nodejs` | satisfies the ITA floor (>=22 LTS) |
| npm | ✅ `11.15.0` | — |
| pnpm | ✅ `10.34.9` | the project's package manager, pinned in `apps/frontend/package.json`; corepack is broken on this box so it is a direct global install |
| git | ✅ `2.49.0.windows.1` | — |
| wrangler (Wrangler CLI) | ❌ not installed | `npm i -g wrangler@4` — local **D1 runs from a file**, so no Docker and no local Postgres are needed |
| Docker | ❌ absent | not needed: `wrangler dev` serves the Worker + a local D1 + a local R2 stand-in |
| tesseract | ✅ present | `tools/look.py --ocr` keeps working from the content repo |
| TLS to npm | ⚠️ FortiGate inspects; cert not in the Windows store | `npm install` can fail with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. pnpm retries through it. Pending: install the Fortinet root CA |

---

## 5. Environment variable inventory

All of it goes in `.env.local`; `.env*` is gitignored in the first commit.

| Variable | Source | Scope | Rotation |
|---|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard | wrangler deploys | — |
| `D1` binding | `wrangler.jsonc` (`database_id`) | every query | — |
| `MEDIA` binding (`R2_BUCKET`) | `wrangler.jsonc` (`bucket_name`) | stored media objects — a binding, not a variable the app reads | — |
| `BETTER_AUTH_SECRET` | generate (`openssl rand -base64 32`) | Better Auth session signing | yearly (invalidates every session) |
| `BETTER_AUTH_URL` | the app's public URL | auth base URL / callbacks | on domain change |
| `RESEND_API_KEY` | Resend dashboard | transactional email | yearly |
| `EMAIL_FROM` | your verified sending subdomain | e.g. `Postvyn <no-reply@mail.example.dev>` | — |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Cloudflare dashboard | signup + reset bot defence | — |
| `TOKEN_ENCRYPTION_KEY` | generate (32 bytes, base64) | encrypts `channel_credentials` | rotate via `key_version` re-encrypt; **losing it means reconnecting every channel** |
| `TOKEN_ENCRYPTION_KEY_VERSION` | stamped with the key (default `1`) | which key a `channel_credentials` row was written with (m5) | bump on every rotation; the re-encrypt pass rewrites older rows |
| `IG_APP_ID` / `IG_APP_SECRET` | Meta app → **entered in the app** | token exchange/refresh | on compromise |
| `IG_USER_ID` / `IG_TOKEN` | Graph Explorer → **entered in the app** | publishing | every ~60 days (automated) |
| `THREADS_USER_ID` / `THREADS_TOKEN` | Meta app → **entered in the app** | publishing | ~60 days — **manual**: only Instagram refreshes on the cron (m5) |
| `R2_ACCOUNT_ID` | Cloudflare dashboard | S3 endpoint | — |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 API token | bucket read/write | every 90 days |
| `R2_PUBLIC_BASE` | R2 custom domain | public base every media URL is built from | on domain change |
| `PUBLISHING_ENABLED` | us | global kill switch (ADR-019) | — |
| `CRON_SECRET` | generate | shared secret for `POST /api/internal/tick` — the Cron Trigger itself needs none | on compromise |
| `CLOUDFLARE_API_TOKEN` *(CI only)* | Cloudflare API tokens — Workers Scripts:Edit + D1:Edit | deploy + migrations from GitHub Actions | yearly (§13.2) |

Two of these are generated by me, not gathered by you: `BETTER_AUTH_SECRET` and
`TOKEN_ENCRYPTION_KEY`.

**The three X rows left with X on 2026-11-17, and YouTube adds none (decision: per-channel, like the
others).** Instagram, Threads and YouTube values are entered in
the app and stored encrypted in `channel_credentials` (ADR-011/012), one row per channel — env holds
one value per key, and this product is one user → many brands → many channels, each with its own
token. The committed contract is `apps/frontend/.env.example`, which lists all 16 variables — the 11
the Worker reads at runtime plus 5 deploy-only values — and says explicitly that social credentials
are not among them.

---

## 6. Decisions needed before M0

Each has a default, so silence is not a blocker — but a wrong default costs a day later.

| # | Decision | Default if you say nothing | Blocks |
|---|---|---|---|
| D1 | Is X automated (credits) or manual like TikTok? — **superseded 2026-11-17: X removed from the product** | moot — no X adapter exists | M5 |
| D2 | Personal brand X handle — `brand.json` says `"x": "TODO"` — **superseded 2026-11-17: X removed; the field is ignored** | omitted from v1 onboarding | M2 |
| D3 | Worker plan: Free vs **Workers Paid ($5)** | **Free first**; move to Paid only if SSR hits the 10 ms CPU ceiling | M5 |
| D4 | Single-user or invites — and is email required? | **single-user, email required**: verification + reset through Resend; invitations deferred to v1.5 | M1 |
| D5 | First workspace name + which brands onboard first | `zavron` only, then `personal` | M2 |
| D6 | Import scope: all brands or just zavron's queue? | all, verbatim | M2 |
| D7 | Auth method: email+password only, or add GitHub OAuth? | **email+password only** | M1 |

---

## 7. Data to hand over

| Item | Where it lives now | Why I need it |
|---|---|---|
| Brand kits | `brands/{personal,zavron}/brand.json` | voice, accent, handle — drives theming and captions |
| Platform specs | `social/{instagram,threads,tiktok,x}/specs.md` | seeds the spec engine (§ ITA 4.2 `SpecRule`) |
| Queue items | `brands/*/social/*/queue/*/` (7 items today) | import fixture and parity test in M2 |
| Media assets | referenced by `item.json` (PNGs, one 8.7 MB MP4) | upload path test, R2 key design |
| Planner format | `planner/README.md` | week-slot vocabulary if the calendar lands in v1.5 |
| Content repo path | `D:/uwi/Projetcs/Uwi's-Department` | importer source; must stay untouched until M6 |

No copying yet — M2 reads it in place. If you reorganise that folder, tell me first.

---

## 8. Compliance checklist (read once, then forget)

| # | Item | Status |
|---|---|---|
| 1 | Meta: agree to Platform Terms + Developer Policies on the app dashboard | ☐ |
| 2 | Meta: app stays in **Development mode** for v1 — no review, no Business Verification, own accounts only | ☐ |
| 3 | Meta: if you ever go Live, you need Privacy Policy URL, Terms URL, data-deletion callback | ☐ (v2) |
| 4 | Google/YouTube: YouTube API Services Terms + Developer Policies on the project; a quota increase needs Google's own audit (X's automation rules left with X, 2026-11-17) | ☐ |
| 5 | TikTok: no automated uploads, ever (in-app scheduler only) | ☐ |
| 6 | You are the only data subject in v1 — no DPA, no cookie banner needed | ☐ |
| 7 | When a second user joins: privacy policy + DPA + deletion path become mandatory | ☐ (v1.5) |

---

## 9. What takes time (plan around this)

| Step | Realistic wait |
|---|---|
| Cloudflare project (D1 + R2), GitHub repo, `wrangler login` | minutes |
| Meta app + Instagram/Threads credentials | under an hour of clicking |
| Google Cloud project + YouTube OAuth client (API enabled, consent **In production**) | minutes, same day |
| ~~X developer account~~ / ~~X credits~~ — **superseded 2026-11-17, X removed** | never |
| **Meta Advanced Access / Business Verification** | weeks — **not needed for v1**, only for SaaS |
| `pnpm install` on this box | slow, possibly several retries (TLS) |

---

## 10. First-run checklist

- [ ] Create the Meta app (Business) + Instagram product, Standard Access
- [ ] Switch the Instagram account to **Business or Creator**
- [ ] Add the Threads product + add yourself as **Threads Tester**
- [ ] Generate `IG_USER_ID`, `IG_TOKEN`, `THREADS_USER_ID`, `THREADS_TOKEN`
- [ ] ~~Decide D1 (X automated or manual)~~ **superseded 2026-11-17 — X removed**
- [ ] ~~If automated: X app with OAuth 1.0a *Read and Write*, buy credits, set a spend cap~~ **superseded 2026-11-17 — X removed**
- [ ] Create the Google Cloud project: enable YouTube Data API v3, OAuth client, consent screen **In production** (§2.5)
- [ ] `wrangler login`, create D1 + R2 bucket, ids into `wrangler.jsonc`
- [ ] Create R2 bucket + token (Object Read & Write) + public custom domain + CORS for `PUT`
- [ ] Decide D3 (Workers Free vs Paid)
- [ ] Fill `.env.local` (values only — do not send them to me)
- [ ] Decide D5 (first workspace/brand) and D6 (import scope)
- [ ] Confirm the domain plan (§13.1): app + mail + media hostnames, DNS zone on Cloudflare
- [ ] Create GitHub Actions secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (§13.2)
- [ ] Create the staging pair — second D1 + backup bucket (§13.3, §13.4)
- [ ] Tell me: "env is filled", plus your answers to D1–D7
- [ ] I run the preflight: secret schema, D1 connect + migrations, cross-workspace isolation test, one dry-run publish

---

## 11. Division of labour

| You | Me |
|---|---|
| create accounts, grant scopes, buy credits | write the code and migrations |
| put secrets in `.env.local` | validate them at boot, never log them |
| visual QA of renders (I am text-only here) | state, specs, scheduling, publishing, verification |
| approve anything that goes live | never publish without that approval |
| decisions D1–D7 | defaults that make silence safe |

---

## 12. Open items

| # | Item | Owner | Needed by |
|---|---|---|---|
| OI-1 | Personal brand has no X account (`"x": "TODO"`) — **superseded 2026-11-17: X removed from the product** | you | — |
| OI-2 | Decide whether the 8.7 MB MP4 stays a video post or gets a lighter export for X — **superseded 2026-11-17: X removed; YouTube accepts the file as-is** | you | — |
| OI-3 | Fortinet root CA → `npm config set cafile` + `NODE_EXTRA_CA_CERTS` | you + IT | before M0 installs |
| OI-4 | Confirm the **D1 primary location** (closest region to you — Singapore for SEA; it is chosen at create time) | you | M0 |
| OI-5 | Which domain carries the app — `zavron.dev` subdomain, or the personal brand? Auth URLs and email reputation hang off this | you | M1 |
| OI-6 | Name the backup bucket and its retention (default: 8 weekly exports) | you | M0 |

---

## 13. Additional requirements (added 2026-Nov-15)

The items below came out of the platform decisions (Cloudflare + Better Auth + Resend). They are
requirements, not nice-to-haves: three of them block M0/M1 outright.

### 13.1 Domains & DNS — three hostnames, one zone

One domain, hosted as a **Cloudflare zone** (move the nameservers at the registrar if it isn't
already there — R2 custom domains and Workers custom routes both require the zone to be on
Cloudflare). Three hostnames, each doing a different job:

| Hostname | Purpose | Record |
|---|---|---|
| `studio.<domain>` (or `queue.`) | the app — `BETTER_AUTH_URL` | Workers custom domain (Cloudflare manages the DNS) |
| `mail.<domain>` | Resend sending identity (`EMAIL_FROM`) | SPF + DKIM TXT, DMARC at `_dmarc` |
| `media.<domain>` | R2 public base for platform-fetched media | CNAME → R2 custom domain |

**Why subdomains and not the root:** mail reputation is perishable — a spam complaint against
`mail.` must never touch the domain your portfolio lives on. Media gets its own hostname so a cache
or CORS rule can't affect the app. And a stable `BETTER_AUTH_URL` means cookies and reset links don't
break when you move the app later.

`zavron.dev` is already owned (`brand.json → links.website`), so `studio.zavron.dev` is the
zero-purchase option. **Decision needed: OI-5.**

### 13.2 CI/CD credentials

GitHub Actions needs to deploy without a human:

| Secret | Scope | Rule |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | **Workers Scripts:Edit + D1:Edit**, limited to this account | never the Global API Key, never account-wide admin |
| `CLOUDFLARE_ACCOUNT_ID` | account id | not secret, but travels with the token |

Rotate yearly, or immediately if a token is ever echoed into a log. A leaked Workers token is
"redeploy whatever I want", so it is scoped and short-lived by policy even if the platform allows
more.

### 13.3 Backups

D1 Time Travel covers 7 days (free) / 30 (paid) — that is a window, not a backup. Add:

- A second R2 bucket (or a `backups/` prefix in the media bucket) receiving a weekly
  `wrangler d1 export`.
- Retention: **8 weekly exports** (~2 months). Data volume is tiny — this costs nothing.
- **`TOKEN_ENCRYPTION_KEY` must not live in that bucket.** Backups contain ciphertext for
  `channel_credentials`, which is safe only while the key lives somewhere else.
- A restore drill before v1.0 — restoring untested backups is how people discover they were corrupt.

### 13.4 Staging separation

Not optional once real accounts are connected:

- Second D1 database (`postvyn-staging`) and a separate R2 bucket/prefix.
- Host on `*.workers.dev`; staging secrets set separately via `wrangler secret --env staging`.
- **Test social accounts**, never the real brands: a private IG account added as an app tester, and
  no YouTube publishing in staging beyond one deliberate test upload — the daily upload budget is
  the spend limit there too.
- Same Meta app for both — the difference is which tokens are configured, not a second app.

### 13.5 Environment hazards on this machine

Verified today; they cost hours if rediscovered mid-build:

| Hazard | Consequence | Handling |
|---|---|---|
| Repo path contains an apostrophe (`Uwi's-Department`) | tooling that receives the path as a subprocess cwd can fail | quote every path; the importer reads it, so it must be tested with the apostrophe present |
| MSYS shell, native tools | `/c/...` paths are not translated for `git`/`node` | pass `C:/...` forward-slash paths to native binaries |
| FortiGate TLS inspection, no root CA | `npm install` → `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | `pnpm` retries through it; permanent fix is OI-3 |
| No Docker, no local Postgres needed | — | `wrangler dev` + local D1 file is the whole dev story |
| pnpm missing, corepack broken | `npm i -g pnpm@10` fails or misbehaves | install pnpm directly; do not rely on corepack |

### 13.6 What not to do

- **Never paste a secret in chat.** Values go in `.dev.vars` / `wrangler secret`; if it's in a
  message it's in a transcript, and it needs rotating.
- **Don't edit the vault while the importer runs.** Freeze `tools/publish` at a git tag before M2 and
  import from that tag.
- **Don't grant the Cloudflare token account-wide** (§13.2).
- **Don't put mail or media on the root domain** (§13.1).
- **Don't add Better Auth's organization plugin mid-build** — tenancy is ours by decision (ADR-017).
- **Don't enable Cache Components / `"use cache"`** — incomplete in vinext and the surface with the
  October 2026 RCE history.