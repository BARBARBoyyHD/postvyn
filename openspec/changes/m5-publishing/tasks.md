## 1. Credentials

- [ ] 1.1 Implement `encrypt`/`decrypt` with AES-256-GCM over WebCrypto, channel id as additional authenticated data, `key_version` stored per row
- [ ] 1.2 `POST /api/v1/channels` and `DELETE` for connect/disconnect, owner-only
- [ ] 1.3 Never return a token or ciphertext from any endpoint; tests assert the absence
- [ ] 1.4 Write a re-encryption pass for `key_version` rotation, with a per-row failure report
- [ ] 1.5 Set channel state from credential health: `active`, `reauth_required`, `disabled`

## 2. Publisher interface

- [ ] 2.1 Define the port: `preview(variant)`, `publish(variant)`, `verify(result)` and the result shape
- [ ] 2.2 Dry run reuses the real path with the network removed, and lists the calls it would make
- [ ] 2.3 Confirmation must name platform and account; a mismatch with the variant's channel is refused
- [ ] 2.4 Record the platform's own error code and message verbatim on failure

## 3. Threads adapter

- [ ] 3.1 Container create → poll → publish → verify, with the 250-post/24h ceiling surfaced
- [ ] 3.2 Text and image variants; video routed through the same container flow
- [ ] 3.3 Fixtures for expired token, rejected container and rate limit

## 4. Instagram adapter

- [ ] 4.1 `REELS`, `IMAGE` and `CAROUSEL` handled as separate shapes, each with its own media requirements
- [ ] 4.2 Media resolved to public URLs — Meta fetches the bytes itself
- [ ] 4.3 Container creation parks the job; polling resumes on a later tick
- [ ] 4.4 Verify by reading the published media back and storing its permalink
- [ ] 4.5 Monthly refresh of the long-lived token, with failure flipping the channel to `reauth_required`

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
