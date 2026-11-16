## Context

Two facts shape this change.

The first is that the content is made elsewhere. A Remotion render finishes as an MP4 on disk; a caption
is written next to it; neither can enter the app today. The second is that the app has no model budget —
it cannot write the caption, and pretending it can would mean a subscription the product does not have.

So the design is an **intake door**: the caller brings the asset and the words, the app brings the rules
and the gate.

## Goals / Non-Goals

**Goals:**

- Get a finished video and its caption onto the board in one call.
- Make the same call available to a human with a file picker and to an agent with a token.
- Keep the human gate untouched: nothing ingested is approved.
- Validate at the door, so a bad caption is a rejected request rather than a card that fails at publish.

**Non-Goals:**

- Generating captions in the app. M5's adapter work and this change both assume the text arrives.
- Transcoding, thumbnails, or image editing — no native image library survives in `workerd` (ADR-013).
- Direct-to-R2 signed uploads (M6). Uploads here go through the Worker, bounded by a size ceiling that
  keeps them inside the CPU and memory budget; signed uploads return when large files do.

## Decisions

**1. One intake module, two doors.**
`intake.createDraft(ctx, payload)` is called by `/api/v1/intake` (session) and `/api/agent/posts` (token).
Two implementations of the same admission rules is how an agent path quietly becomes more permissive than
the UI.

**2. A token is a workspace and brand scope, not a user.**
`agent_tokens(workspace_id, brand_id, token_hash, label, revoked_at)`. The context it produces has
`userId = null` and `role = "editor"` derived from the scope — deliberately *not* "owner", because
`variant.approve` requires owner and a token must never hold the gate.

**3. Hashed, not encrypted.**
A token is compared, never replayed, so SHA-256 over the secret is enough and a database dump yields
nothing usable. (Platform credentials are the opposite case and stay AES-GCM — ADR-011.)

**4. Ingest validates, and creates anyway.**
A blocked caption still creates the post, in `review`, with `spec_state = blocked`. Refusing the whole
request would lose the asset and the caller's intent; creating it silently would hide the problem. The
response carries the verdict so the caller can fix it in the same session.

**5. Media is stored by hash, with the workspace in the key.**
`media/<workspace>/<hash>.<ext>`, deduplicated on `(workspace_id, hash)`. The same asset pushed twice — a
retry, a re-render with identical bytes — is one object.

**6. The size ceiling is a product limit, not a technical one.**
25 MB for local uploads through the Worker. Large files wait for M6's signed uploads; saying so in the
error is cheaper than letting a 200 MB upload time out mysteriously.

## Risks / Trade-offs

- **A token leaks** → hash-only storage, per-brand scope, no approval reach, revocation is a timestamp.
- **Uploads through the Worker are slow for video** → bounded at 25 MB, with the limit named in the error;
  M6 lifts it with signed URLs.
- **Callers push whatever caption they like** → the spec engine is the censor, and the verdict is stored
  with the draft, so the human sees the objection before approving.
- **Two doors drift** → one intake module; the tests call both and compare.

## Migration Plan

- Add `agent_tokens`; no data migration. Existing `media` rows keep their keys.
- Rollback: revoking every token disables the agent door without touching the UI path.
- Forward: M6 replaces the key scheme with public URLs derived from `R2_PUBLIC_BASE`; the intake shape
  does not change.
