## 1. Credentials

- [x] 1.1 Implement `encrypt`/`decrypt` with AES-256-GCM over WebCrypto, channel id as additional authenticated data, `key_version` stored per row — `src/lib/crypto.ts` + `requireTokenEncryptionKey()` in `src/lib/env.ts`; key is `TOKEN_ENCRYPTION_KEY` (32 bytes base64), version from `TOKEN_ENCRYPTION_KEY_VERSION` (default 1); tamper/AAD/wrong-key covered in `test/crypto.test.ts`
- [x] 1.2 `POST /api/v1/channels` and `DELETE` for connect/disconnect, owner-only — `src/app/api/v1/channels/route.ts`; connect upserts credentials on an existing (brand, platform, accountRef) so reconnect is the same call; DELETE clears the credential row and sets `disabled`, never deletes the channel
- [x] 1.3 Never return a token or ciphertext from any endpoint; tests assert the absence — connect/list/detail shapes scanned for plaintext, ciphertext and field names in `test/credentials.test.ts`; every channels route answers `401` in `test/routes.test.ts`
- [x] 1.4 Write a re-encryption pass for `key_version` rotation, with a per-row failure report — `rotateCredentials(env, {from, to})` in `src/db/credentials.ts` returns `{ok, rotated, failed:[{channelId, reason}]}`; one unreadable row is reported and the rest still rotate (tested)
- [x] 1.5 Set channel state from credential health: `active`, `reauth_required`, `disabled` — `channels.status` already existed (no migration needed); reads derive the state (`effectiveChannelStatus`, left join on credential existence) so an imported channel is never `active`, and a failed decrypt at publish time flips the channel to `reauth_required` with an audit row

## 2. Publisher interface

- [x] 2.1 Define the port: `preview(variant)`, `publish(variant)`, `verify(result)` and the result shape — `src/publishers/port.ts`: `PublishResult` is `published | awaiting_platform | uncertain | failed | not_connected`, failures carry `{code, message}`; `src/db/tick.ts` calls `verify()` on any success before storing `published` (non-negotiable 4)
- [x] 2.2 Dry run reuses the real path with the network removed, and lists the calls it would make — `src/publishers/transport.ts` (`liveTransport` / `recordingTransport`) + `previewFlow()`; the test double proves preview and publish emit the same first call and the dry run makes no request. Listing stops at the first send, because a later call's URL depends on the platform's answer
- [x] 2.3 Confirmation must name platform and account; a mismatch with the variant's channel is refused — `confirmTargets()` in `src/lib/publish-confirm.ts`, enforced by `POST /api/v1/posts/:id/publish` (`422 confirmation_mismatch`, before any approval); the upload button now sends one confirmation per variant's channel
- [x] 2.4 Record the platform's own error code and message verbatim on failure — `publish_results.raw` holds `{code, message}` as received, `jobs.last_error` carries them on the failing attempt; asserted in `test/publishing.test.ts`

## 3. Threads adapter

- [x] 3.1 Container create → poll → publish → verify, with the 250-post/24h ceiling surfaced — `src/publishers/threads.ts`: create → poll `status` → `threads_publish` → read-back; `THREADS_POSTS_PER_24H = 250` (cited to `docs/001-PRD.md` FR-08) is shown in `preview().notes`, surfaced and not enforced per ITA §6; "creates, polls, publishes, then takes the permalink from the read-back" and "shows the 250-post ceiling…" in `test/publish-threads.test.ts`
- [x] 3.2 Text and image variants; video routed through the same container flow — `containerParams()` sets `media_type` TEXT / IMAGE / VIDEO with `image_url` or `video_url`; one media item per post, and more is refused as `media_unsupported` rather than silently dropped (Threads carousel is not wired)
- [x] 3.3 Fixtures for expired token, rejected container and rate limit — `test/fixtures/threads/{expired-token,rejected-container,rate-limit,text-published,read-back-mismatch}.json` read through `test/support/fixture-transport.ts`; expired token (190/463) is `reauth_required` + channel flipped + audit row, rate limit (613) stays a retryable `failed`, rejected container quotes Meta's `error_message` verbatim

## 4. Instagram adapter

- [x] 4.1 `REELS`, `IMAGE` and `CAROUSEL` handled as separate shapes, each with its own media requirements — `src/publishers/instagram-shapes.ts`: count and kind per shape, carousel ceiling reuses the spec engine's `PLATFORM_RULES.instagram.mediaMax` instead of a second copy; shape named in `preview().notes`, refusals are `media_required` / `too_many_media` / `media_unsupported`
- [x] 4.2 Media resolved to public URLs — Meta fetches the bytes itself — `src/db/media.ts`: `mediaIds` → `R2_PUBLIC_BASE` + R2 key, in variant order; refuses `base_missing` (names the variable), `no_object_key` (names the row, old vault path), `not_postable`, `media_missing` before the adapter runs; "media has to resolve to a public URL" in `test/publish-instagram.test.ts`
- [x] 4.3 Container creation parks the job; polling resumes on a later tick — `jobs.park` stores the container id in the payload, `jobs.resumeParked` does `awaiting_platform → queued` so the resume goes back through `claim` (lease, attempts, kill switch), and `publishVariant` resumes via `verify()` instead of creating a second container; "polls on the next tick…" and "creates one container, not one per tick" in `test/publish-instagram.test.ts`
- [x] 4.4 Verify by reading the published media back and storing its permalink — `readBackAnswer()` in `src/publishers/meta.ts` is the only path to `published`: a failed read is `uncertain`, a different id is `uncertain`; "a read-back that disagrees is uncertain, never published" in `test/publish-threads.test.ts`
- [x] 4.5 Monthly refresh of the long-lived token, with failure flipping the channel to `reauth_required` — `src/publishers/instagram-token.ts` + `src/db/token-refresh.ts`, run from `runScheduled` every tick and gated by `INSTAGRAM_REFRESH_AFTER_MS` (25 of the token's 60 days); a refusal is `markReauth` + a `channel.token_refresh_failed` audit row; `test/token-refresh.test.ts` covers fresh/refreshed/refused

## 5. X adapter

- [ ] 5.1 OAuth 1.0a request signing from four stored credentials
- [ ] 5.2 Chunked video upload where the post carries video
- [ ] 5.3 Cost estimate from the post's shape; shown before the first post, stored with the result
- [ ] 5.4 Refuse to publish when credits are not configured, with a message that says so
- [ ] 5.5 `402` handling recorded as a cost problem, not a failure

## 6. TikTok pack

- [ ] 6.1 Generate a pack: caption, hashtags, ordered asset paths, checklist, one-line reason
- [ ] 6.2 Record manual completion with the operator's post URL; `published` only then
- [ ] 6.3 Show the guideline reason wherever a TikTok target appears

## 7. Failure handling

- [ ] 7.1 Email on a failed scheduled publish: platform error, account, post link, one suggested action
- [ ] 7.2 Treat `uncertain` as needing a human, never as retryable
- [ ] 7.3 Confirm `one_publish_per_variant` prevents a second success even under a retry bug

## 8. Close-out

- [ ] 8.1 Mark `US-036`…`US-045` in `docs/006-USER-STORIES.md`
- [ ] 8.2 Record real costs observed for the first X post in the journal
- [ ] 8.3 Run `openspec validate m5-publishing` and confirm the change is complete before archiving
