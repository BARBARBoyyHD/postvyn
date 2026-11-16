## Why

Everything until now assumed the content was written inside the app. The actual workflow is the
opposite: a video gets made somewhere else — a Remotion render, a phone recording, a preview cut — and
the captions get written beside it. Today that means dragging files and re-typing text into a board
that cannot accept files at all.

This change adds the missing entrance: **assets and drafts arrive from outside**, land in `review`, and
wait for the same human gate everything else obeys. Two callers, one path: you, signed in; and Hermes,
holding a token.

## What Changes

- **Assets can be uploaded.** A signed-in operator drops files in, or an agent posts bytes to an
  endpoint. Either way the object lands in R2, a `media` row records it, and the publishable ones become
  attachable.
- **A draft can arrive complete.** One call carries the title, the target channels, and per-channel
  caption + hashtags + media order. Validation runs at ingest, so a rejected caption is reported to the
  caller instead of sitting on a card waiting to fail at publish time.
- **Agent tokens.** A token is minted for one workspace and one brand, stored as a hash, printed once,
  revocable. It can create drafts and upload assets; it cannot approve or publish. The human gate is not
  something a token can hold.
- **Hermes gets a client.** `pnpm agent:push` hands a file plus caption and hashtags to the intake
  endpoint and prints the post link, so "make me a video" ends with a card on the board rather than a
  folder on disk.
- **The caption is supplied, not invented, at v1.** The app has no model budget; the caller that made the
  video is the one that knows what it is about. The app's job is to *check* the caption against the
  platform rules before it is stored — which it already knows how to do.

## Capabilities

### New Capabilities

- `asset-intake`: uploading bytes, deciding what they are, and recording them.
- `agent-intake`: the token model and the one-shot draft endpoint Hermes calls.
- `draft-intake`: turning an outside payload into a post in `review`, with the spec verdict attached.

### Modified Capabilities

- `manual-tiktok` (M5, unbuilt): a TikTok draft now arrives with its assets already attached, so the
  manual pack is generated from files the app holds rather than paths it hopes exist.

## Impact

- **Code**: `src/app/api/agent/*` (token-authenticated), `src/app/api/v1/intake` (session-authenticated),
  `src/lib/agent-token.ts`, `src/db/intake.ts`, `src/app/(app)/intake/page.tsx`,
  `tools/agent/push.mjs`, `tools/agent-token.mjs`.
- **Schema**: `agent_tokens` (hash, scope, revocation). `media` already exists from M0; M6's R2 wiring
  moves forward to this change for uploads only.
- **Not in scope**: approval, scheduling, publishing (M4/M5), image processing or re-encoding, and any
  generation of captions by the app itself.

## The rule that does not move

An ingested draft is `review`. Not `approved`, not `scheduled`. A token that could approve its own work
would make the approval meaningless, so `variant.approve` stays owner-only and cookie-only — there is no
code path from a bearer token to an approval.
