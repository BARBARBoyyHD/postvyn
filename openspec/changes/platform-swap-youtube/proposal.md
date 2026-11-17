## Why

The platform lineup is a product decision, and on 2026-11-17 it changed: **X is out, YouTube is in.**
X charges per post ($0.015, $0.20 with a link) — the only resource in this product that costs money to
speak to — and the decision is to drop it rather than meter it. YouTube takes the slot with what this
product actually makes: **video uploads — regular VOD and Shorts** — metered by API quota rather than
by the post.

Everything the product promises about publishing has to hold on the new platform before it ships: a
human approved exactly this content, a 200 is not success, and the scarce resource is shown before it
is spent. The last one changes its currency from dollars to quota units; it does not change.

## What Changes

- **X leaves the product.** The adapter, OAuth 1.0a signing, chunked media upload, the per-post cost
  model, `X_CREDITS_CONFIGURED`, the connect form, and every X rule in the spec engine are removed.
  X's cost-disclosure requirement is REMOVED from `publishers`, superseding `m5-publishing`'s open
  delta, with a migration to the quota disclosure below. Historical X rows — channels, publish
  results, stored estimates — stay in the database untouched.
- **YouTube joins: VOD + Shorts.** A resumable upload (session initiate → chunked PUT → `videos.list`
  read-back) behind the same publisher port; `published` only after the read-back agrees, exactly as
  for every other platform.
- **YouTube metadata rules in the spec engine**, checked before any API call: title ≤ 100 characters,
  description ≤ 5000 bytes, tags ≤ 500 characters total — named constants carrying their source and
  read date, because Google has changed these before and will again.
- **Quota is disclosed before it is spent.** The preview states the upload's quota cost against the
  project's daily allocation before the first byte moves — money-before-spend's quota cousin.
- **Connect works like the others.** Operator-created Google OAuth client + refresh token entered in
  the app, encrypted per channel, exercised monthly; no in-app Google redirect flow, consistent with
  how Meta credentials arrive.
- **Docs follow the decision**: PRD scope/cost/risk rows, ITA integrations, the env inventory (three X
  rows out; YouTube adds none), the story tracker (US-038 retired, five YouTube stories added),
  AGENTS.md's non-negotiable 6, and the Home dashboard.

## Capabilities

### New Capabilities

None. YouTube rides the capabilities `m5-publishing` defines; nothing about the publisher contract
changes — only who implements it.

### Modified Capabilities

- `publishers` (m5, open): **+** YouTube upload / verify / quota requirements; **−** X's cost
  disclosure (REMOVED, superseding m5's delta); **~** the adapter-mechanics requirement loses its X
  mention (MODIFIED).
- `platform-connections` (m5, open): **+** a YouTube connect requirement; **~** the token-refresh
  requirement gains a YouTube scenario. X's removal here has no requirement to delete — X was never
  named in this capability — so it is form, registry and env work, tracked in tasks.
- `spec-engine` (archived baseline): **+** YouTube metadata/format rules; **~** the counting
  requirement drops X's link pricing in favour of byte arithmetic (MODIFIED against the m3 baseline,
  which validates normally).

## Impact

**Code** (specialists implement immediately after this change)

- New: `src/publishers/youtube.ts` (OAuth2 mint, resumable upload, read-back, quota constants),
  `test/publish-youtube.test.ts`, `test/fixtures/youtube/*`, two migrations that rebuild the
  `platform` CHECKs.
- Changed: `src/lib/specs/platforms.ts` (Platform union, rule set), `src/publishers/registry.ts`,
  `src/publishers/port.ts`, `src/app/(app)/channels/page.tsx`, `src/db/token-refresh.ts`,
  `src/db/alerts.ts`, `src/db/tick.ts`, `src/lib/env.ts`, `.env.example`.
- Deleted: `src/publishers/{x,x-oauth,x-media}.ts`, `test/publish-x.test.ts`, X's spec rules, the
  link-cost counting branch, the 402/`cost_blocked` special path.

**Schema**: `channels` (0004) and `publish_results` (0011) CHECKs gain `'youtube'` (SQLite rebuild)
and keep `'x'` for existing rows; `publish_results.estimated_cost_usd` stays as the generic estimate
column so past X results keep rendering.

**Docs**: `001-PRD`, `003-ITA`, `004-PEP`, `005`, `006`, `runbook`, `AGENTS.md`, `Home.md`, app
`README` — amended in this spec pass (2026-11-17); `006`'s new rows tick as code lands.

**Explicitly not in this change**: an in-app Google OAuth redirect; YouTube Analytics, comments,
playlists or thumbnail APIs; per-workspace quota accounting (shown, not enforced — Threads' 250-post
ceiling is the precedent); variant-level titles; deleting historical X rows; keeping any X code path
"just in case".

## The principle that does not move

Money before spend becomes **scarce resource before spend** on 2026-11-17: whatever a publish costs —
dollars, quota units, a manual step — the operator sees it before it happens. X left the product; the
principle did not.
