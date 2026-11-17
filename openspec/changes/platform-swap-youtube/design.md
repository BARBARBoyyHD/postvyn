## Context

The lineup decision (2026-11-17) removes the product's only money-metered platform and adds the first
one metered by quota. M5's X work is already built and ticked; this change deletes it and adds
YouTube beside the IG/Threads adapters that remain. The runtime constraints that shaped m4/m5 still
hold: a Worker cannot outlive a request (so long uploads park), D1 has one writer (so job claims
serialize), and a 200 is never success (so read-back gates `published`).

Two facts about YouTube shape everything below. **Quota is the scarce resource** — and Google has
already changed the quota model once (around June 2026), so every number in this change carries a
source and a read date. **The upload is long and resumable** — bytes stream through the Worker, so
interruption must resume, not restart.

## Goals / Non-Goals

**Goals:**

- X gone from the product surface: no live code path, env var, form or rule references it.
- YouTube VOD and Shorts uploads that survive a Worker dying mid-upload.
- The four non-negotiables hold on YouTube exactly as elsewhere: approval, spec gate,
  quota-before-spend, read-back verification.
- Zero behaviour change for Instagram, Threads and TikTok.

**Non-Goals:**

- In-app Google OAuth redirect/consent — credentials are pasted in, consistent with Meta.
- YouTube Analytics, comments, playlists, thumbnails, live/Streams.
- Per-workspace quota accounting or enforcement — shown, not enforced (Threads' ceiling precedent).
- Variant-level titles; Shorts as a declared schema field; quota-increase workflows.
- Rewriting or deleting historical X rows.

## Decisions

**1. OAuth2 with operator-entered credentials; no in-app Google flow.**
The operator creates a Google Cloud project, enables **YouTube Data API v3**, publishes the OAuth
consent screen to **In production**, creates an OAuth client, runs the consent flow outside the app
(OAuth Playground or the client's own redirect), and pastes `clientId`, `clientSecret` and
`refreshToken` into the channel connect form — the same enter-in-the-app path as Meta
(ADR-011/ADR-012: per-channel, encrypted in `channel_credentials`, never in env, never in a
response). The app mints ~1-hour access tokens from the refresh token at publish time.
Source for the expiry rules — Google Identity "Using OAuth 2.0 to Access Google APIs"
(`developers.google.com/identity/protocols/oauth2`), last updated 2026-10-29, read 2026-11-17:

- Consent screen **External + Testing → refresh token dies in 7 days**. **In production → durable**
  (an unverified production app still yields durable tokens; the "unverified app" warning is expected
  and harmless for a one-operator tool).
- Refresh tokens also die on revocation, ~6 months unused, password change, or past 100 tokens per
  account per client. Every one of those arrives as `invalid_grant` → `reauth_required`, never a
  crash.

**2. Monthly exercise pass, mirroring Instagram's refresh.**
Instagram refreshes a 60-day long-lived token on a monthly cron; YouTube's refresh token does not
expire on a schedule but does die silently (revoked, Testing-mode, unused). So the same monthly pass
(a named 30-day constant in the token-refresh module — not an env var) mints an access token per
YouTube channel: success keeps the channel `active`; `invalid_grant` → `markReauth` + audit row +
failure email, exactly the Instagram path. The pass also defeats Google's 6-month unused-token
invalidation by definition.

**3. Resumable upload; interruption parks; read-back gates `published`.**
Flow: initiate (`POST .../upload/youtube/v3/videos?uploadType=resumable` with the metadata JSON) →
200 + `Location` session URL → chunked `PUT`s streamed from the media's public R2 URL (no Worker
buffers the whole file; the source is ranged by offset) → final PUT answers the video id →
`videos.list?part=id,snippet,status` read-back.

- **Park/resume**: the session URL and the byte offset live in the job payload. A failed or
  truncated PUT parks `awaiting_platform`; the next tick resumes the PUT from that offset — never a
  second session for the same upload (m5 4.3's container pattern: one upload, not one per tick).
- **Read-back (non-negotiable 4)**: `published` only when `videos.list` returns the id with
  `uploadStatus: processed`, the requested `privacyStatus`, and the title as sent. Still processing →
  park and poll on the tick cadence with a bounded poll budget; outliving the budget → `uncertain`,
  a human looks. `rejected` → terminal failure quoting YouTube's `rejectionReason` verbatim. A
  read-back that disagrees with what we sent → `uncertain`, never `published`.
- **URL**: built only from the read-back id (`https://www.youtube.com/watch?v=<id>`). A URL derived
  from anything other than a verified read-back id is forbidden — the id is the platform's own.
- **Ambiguity rule**: if the final PUT's response is lost, query the session status before anything
  else; completed → read-back, not completed → resume. A blind re-upload would double-post, which is
  worse than `uncertain`.

**4. Shorts are derived from the media, not declared.**
YouTube categorizes automatically: videos uploaded after 2024-10-15 with a **square or vertical aspect
ratio up to three minutes** are Shorts; wider uploads are long-form (YouTube Help, "Understand
three-minute YouTube Shorts", `support.google.com/youtube/answer/15424877`, read 2026-11-17;
YouTube Blog, "Tall updates coming to Shorts", 2024-10-03). So v1 derives intent from the file —
width, height and duration from the existing media probe — with no schema field:

- Short-shaped (square/vertical, ≤ 3 min): `#Shorts` is appended to the description if absent (the
  convention), and `preview().notes` says it will be categorized as a Short.
- Anything else: VOD upload; the preview says long-form.
- The preview always states the classification, so an operator aiming at a Short with a horizontal
  file sees the mismatch before spending quota. No new blocking rule: YouTube accepts either — this
  is disclosure, not validation.

**5. Quota: named constants, shown before the first byte, cited to today's docs.**
The disclosure is the money-before-spend principle with a new currency. One comment block, copied
verbatim by the implementer:

```
// Source: YouTube Data API v3 Quota Calculator, developers.google.com/youtube/v3/determine_quota_cost,
// read 2026-11-17: default allocation = 100 videos.insert calls/day (its own "Video Uploads" bucket,
// 1 unit each) + 10,000 units/day for all other endpoints combined (videos.list = 1 unit);
// daily reset midnight Pacific Time. The older model most guides still quote — 1,600 units per
// insert from a 10,000/16,000-unit shared pool ≈ 6–10 uploads/day — predates Google's quota
// revision (~June 2026) and must not be used for display. If the project's Google Cloud Console →
// Quota page disagrees, THE CONSOLE WINS: update these constants and this read date. Same stance as
// Meta's content_publishing_limit endpoint.
YOUTUBE_UPLOAD_SLOTS_PER_DAY_DEFAULT = 100;    // videos.insert bucket
YOUTUBE_UPLOAD_SLOT_UNITS = 1;                // charged per insert, from that bucket
YOUTUBE_GENERAL_UNITS_PER_DAY_DEFAULT = 10_000; // shared bucket (reads, polls)
YOUTUBE_READ_BACK_UNITS = 1;                  // videos.list
YOUTUBE_QUOTA_RESET_AT = "midnight Pacific Time";
```

- `preview().notes` carries the line before any request: what this publish consumes (1 upload slot +
  1 read unit), against the daily allocation, and when it resets — X's cost line, in units.
- The estimate is recorded with the result under a `quota` key in `publish_results.raw` — ours,
  beside the platform's own response. No new column; `estimated_cost_usd` stays dollars.
- **Shown, not enforced** (Threads' 250-ceiling precedent, ITA §6): no per-workspace quota counter in
  v1. Exhaustion arrives as YouTube's own `403 quotaExceeded` → **terminal**: immediate dead-letter,
  `publish.quota_blocked` in the audit log, YouTube's code+message stored, no retries — every retry
  is another insert call, and tomorrow's quota cannot be created today (the same reasoning as X's 402
  in m5 5.5, minus the money).
- Upload rejection is terminal for the same reason: re-initiating burns a slot for a deterministic
  answer.

**6. Metadata mapping: `post.title` is the video title; the caption is the description.**
Variants carry caption + hashtags and no title field; adding one for a single platform is a schema
change v1 does not need. So: `snippet.title` = `post.title` (validated ≤ 100 characters when the
variant targets YouTube — the spec gate passes the title into `validate()` for YouTube only),
`snippet.description` = variant caption + hashtags (≤ 5000 **bytes** UTF-8 — the API counts bytes;
YouTube Help says "characters", but the API reference is the validator), tags = hashtags counted as
one string ≤ 500 characters, including the commas between items and the quotes YouTube counts for
spaced tags. Source for all three: YouTube Data API v3 `videos` resource reference
(`developers.google.com/youtube/data/reference/rest/v3/videos`), last updated 2026-11-17, read
2026-11-17. Per-platform titles remain a known v1 limitation; a variant-level title is the path if it
ever matters (out of scope).

**7. X-specific code is deleted; history is not.**
Deleted: `src/publishers/{x,x-oauth,x-media}.ts`; `case "x"` and `PublisherOptions.creditsConfigured`
from `registry.ts`; `X_CREDITS_CONFIGURED` (`env.ts` + `.env.example`); the credits plumbing in
`tick.ts`; `PAYMENT_REQUIRED_CODE`, `isPaymentRequired()` and the 402/`cost_blocked` special path
(dead without X — no supported platform returns 402; YouTube's terminal path is its own, decision 5);
the X connect form and every X label; X's spec rules (`captionCeiling 280`, `linkCost 23`,
`mediaMax 4`) and the link-pricing branch of the caption counter — no supported platform prices
links, so `linkCost`/`countUrlsAs` leave the rule shape (one caller means no caller);
`test/publish-x.test.ts` and X's fixture cases.
Kept: `publish_results.estimated_cost_usd` (generic column — past X results keep their stored
estimates and the UI keeps rendering them, so `src/lib/cost.ts` and its test stay); every historical
X row in `channels`, `publish_results` and `activity_log` (import-verbatim philosophy: an import
dispute is worse than an ugly field); and legacy `x` channels themselves — marked `disabled` with
credentials cleared, so nothing can publish to them and nothing is deleted.

**8. Schema: two CHECK rebuilds; `'x'` stays in both, `'youtube'` joins both.**
SQLite cannot ALTER a CHECK (m5 5.5 recorded this), so `channels` (migration `0004`) and
`publish_results` (`0011`) are rebuilt: create-new, copy verbatim, swap. `'x'` must stay — the copy
would fail on existing rows otherwise, and legacy channels are kept anyway (decision 7). `'youtube'`
joins so new rows insert. New X rows are prevented by the `Platform` union, the registry's exhaustive
switch and the connect schema — the CHECK is not the product boundary, and pretending otherwise would
break the history it has to carry.

**9. OpenSpec ordering: this change archives after `m5-publishing`.**
Its REMOVED/MODIFIED deltas match requirement headers that currently live only in m5's open change
folder (`publishers`, `platform-connections`); those headers enter `openspec/specs/` when m5 archives.
`openspec validate` passes today — OpenSpec does not cross-check deltas against other open changes
(Fission-AI/OpenSpec#1112) — but archiving this change first would fail loudly with "REMOVED
requirement not found", which is the correct failure. m5 stays open until then; with 8.2 descoped (X
removed 2026-11-17) m5 is otherwise complete.

## Risks / Trade-offs

- **Google changes the quota model again** (it did, ~June 2026) → constants carry source + read date,
  preview text derives from them, the Console wins disputes; one comment block to update.
- **Testing-mode 7-day refresh tokens** → connect instructions say "In production" in bold, and a
  token that dies anyway lands in `reauth_required` with Google's own `invalid_grant` — visible, not
  silent.
- **A Worker dies mid-upload** → session URL + offset on the job; resume, never re-initiate. A lost
  session URL *before* completion is safe to re-initiate (no video exists until the final PUT
  completes); a lost response to the *final* PUT is status-queried or `uncertain`, never blindly
  re-uploaded.
- **Processing outlives the poll budget** → `uncertain`, never `published` (the m4 rule).
- **Tests used `'x'` as convenient filler** (two dozen fixtures) → an explicit migrate-to-`threads`
  task, and the `PLATFORM_RULES` key assertion updates in the same pass.
- **Read-back polling burns general-bucket units** (1 each from the 10,000/day pool) → poll on the
  existing tick cadence with a bounded budget, same posture as container polling.

## Migration Plan

- **Apply**: two migrations rebuild the CHECKs (copy verbatim, no data loss); the code swap is one
  deploy; legacy X channels flip to `disabled` with credentials cleared in the same pass.
- **Rollback**: redeploy the previous build — the new schema is a superset (`youtube` allowed, `x`
  allowed), so old code runs against the new database unchanged; YouTube channels simply have no
  adapter.
- **Forward**: `m5-publishing` archives first, then this change; `docs/006` rows tick as each story
  demonstrates.
