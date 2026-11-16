## 1. Tokens

- [x] 1.1 Migration `0016_create_agent_tokens_table.sql`: workspace, brand, label, hash, created, last used, revoked
- [x] 1.2 `src/lib/agent-token.ts`: mint (32 random bytes, base64url, printed once), hash (SHA-256), verify in constant time
- [x] 1.3 `tools/agent-token.mjs`: `create`, `list`, `revoke` against local or remote D1
- [x] 1.4 Resolve a token to a context: workspace + brand scope, `userId = null`, role `editor`
- [x] 1.5 Refuse `variant.approve`, `variant.publish`, `post.delete` for token contexts — asserted by test
- [x] 1.6 Record the token label as the actor in `activity_log`

## 2. Asset upload

- [x] 2.1 `POST /api/v1/media` (session) and `POST /api/agent/media` (token) sharing one implementation
- [x] 2.2 Magic-byte sniffing: PNG, JPEG, WebP, GIF, MP4, MOV — SVG refused with its reason
- [x] 2.3 Ceiling of 25 MB enforced before the object is written; the error names the limit
- [x] 2.4 Store under `media/<workspace>/<hash>.<ext>`, deduplicate on `(workspace, hash)`
- [x] 2.5 Record mime, bytes, dimensions (where cheaply available), and `postable`
- [x] 2.6 List unattached assets so an upload that arrives before its post is not lost

## 3. Draft intake

- [x] 3.1 `intake.createDraft(ctx, payload)` — post + variants + media attachment in one call
- [x] 3.2 `POST /api/v1/intake` (session) and `POST /api/agent/posts` (token) as the two doors
- [x] 3.3 Payload: title, format, pillar, targets[{ channelId, caption, hashtags, mediaIds }]
- [x] 3.4 Validate every target with the spec engine; return per-variant verdict and issues
- [x] 3.5 Create in `review`, never in a later state; write `spec_state`, `spec_version`
- [x] 3.6 Report per-target failures individually — a partial success is not a silent success
- [x] 3.7 `GET /api/agent/posts/:id` returning status and verdicts, for a caller that wants to poll

## 4. Human path

- [x] 4.1 `/intake` page: file picker, caption, hashtags, channel select, submit
- [x] 4.2 Show the verdict immediately, before leaving for the board
- [x] 4.3 Link from the board and the compose page

## 5. Hermes client

- [x] 5.1 `tools/agent/push.mjs`: `--file`, `--caption`, `--hashtags`, `--platform`, `--title`, `--base`, `--token`
- [x] 5.2 Prints the post URL and the verdict; exits non-zero on a blocked verdict
- [x] 5.3 Document the flow in `apps/frontend/README.md` with a real invocation

## 6. Close-out

- [x] 6.1 Prove it end to end: render → push → card in `review` → human approves in M4
- [x] 6.2 Run `openspec validate agent-intake`
- [x] 6.3 Note in the journal what the caption generator question turned out to be
