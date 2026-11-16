## Why

M4 gave the machine the ability to publish. M5 gives it a destination — the three platform adapters that
can actually be automated, and the honest manual path for the one that cannot.

This is also where the product's claims about itself get tested by reality: Meta's container dance,
X's per-post cost, and TikTok's refusal to be automated. Each is a constraint the app must express
rather than hide.

## What Changes

- **Channel connections** for Instagram, Threads and X: credentials entered in the app, encrypted at
  rest with `TOKEN_ENCRYPTION_KEY`, one row per channel — never in env, never in the repo.
- **Instagram adapter**: container → poll → publish → verify, with `REELS`, `IMAGE` and `CAROUSEL`
  handled separately, and media served from a public URL because Meta fetches it itself.
- **Threads adapter**: the same two-step shape against a simpler API, remembering its 250-post/24h
  ceiling.
- **X adapter**: OAuth 1.0a user context, chunked video upload, and a **cost estimate shown before the
  first post** — X is pay-per-post now, and surprise is a worse failure than refusal.
- **A dry run that prints the exact calls** and never touches the network, because "what would be sent"
  is a question the operator asks before every first publish to a new account.
- **Verification is part of publishing**: a post is `published` only after it has been read back from the
  platform and its URL stored.
- **TikTok produces an upload pack**, not a post: caption, hashtags, assets, checklist, and a recorded
  manual completion. Their guidelines refuse utility uploads to managed accounts; shipping a pack is
  compliance, not a missing feature.
- **Token lifecycle**: monthly refresh where the platform allows it; an expired token flips the channel
  to `reauth_required`, shows on the board, and emails the operator.

## Capabilities

### New Capabilities

- `platform-connections`: entering and storing credentials safely, and the channel state machine that
  follows from their health.
- `publishers`: what each adapter must do — preview, publish, verify — and the contract every adapter
  obeys.
- `manual-tiktok`: the pack generator and the recorded completion, which is what shipping to TikTok
  actually means here.

### Modified Capabilities

None. M4's job queue already defines the publisher port this fills in.

## Impact

**Code**

- New: `src/publishers/{instagram,threads,x,tiktok}.ts` behind one interface,
  `src/lib/crypto.ts` (AES-256-GCM with `key_version`), `src/app/api/v1/channels/`,
  `src/app/api/v1/variants/[id]/publish/`, `src/app/api/v1/variants/[id]/verify/`.
- Changed: `channel_credentials` writes, job payloads, failure email via Resend.

**Explicitly not in this change**: media upload (M6). Publishers consume media URLs that already resolve
publicly; M6 owns getting bytes into R2 and exposing them.

## Cost note, stated where it will be read

Instagram and Threads are free. X is not: roughly `$0.015` per post, and more when the post contains a
link. The estimate is shown before the first X publish and recorded with the result, because a product
that quietly spends money per click is a product that gets switched off.
