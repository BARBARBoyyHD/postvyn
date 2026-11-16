## Context

Three platforms can be automated and one cannot, and the difference is not technical — it is written
into TikTok's Content Sharing Guidelines, which name "a utility tool to help upload contents to the
account(s) you or your team manages" as unacceptable. An app that ignores that ships a banned integration
and loses the account.

The other constraint is money: X stopped having a free tier, so every X post has a price. That turns a
routine publish into a spending decision, and spending decisions need disclosure.

## Goals / Non-Goals

**Goals:**

- Publish to Instagram and Threads end to end, verified, with tokens that refresh themselves.
- Publish to X with the cost visible before the first time and recorded after.
- Ship TikTok as a pack a human can post in thirty seconds.
- Never a duplicate post caused by a retry after an ambiguous response.

**Non-Goals:**

- TikTok automation of any kind. Not now, not with an audited app — it is the wrong product for that
  platform.
- Analytics, comment management, DMs (v2 at the earliest).
- Scheduled retries of a post that *may* have succeeded. Uncertainty goes to a human.

## Decisions

**1. One interface, four implementations, one of which refuses.**
`publisher.preview()`, `publisher.publish()`, `publisher.verify()`. The TikTok implementation's
`publish()` returns a pack instead of posting, and says so in the type's documentation. A missing adapter
would be rediscovered every sprint; a refusing one is explicit.

**2. Credentials live per channel, encrypted, with a key version.**
`channel_credentials(channel_id, ciphertext, iv, key_version)`; the channel id is bound as AAD so a
database dump cannot move a token between rows. `TOKEN_ENCRYPTION_KEY` never sits next to the dump.

**3. Instagram's container is a state, not a sleep.**
`publish()` creates the container and hands the id to the job; `verify()` polls it. That is exactly the
`awaiting_platform` state M4 built, and it is why that state exists.

**4. A read-back is what makes `published` true.**
Platform APIs report success for posts that never appear (privacy settings, region blocks, container
timing). The adapter fetches the post and stores the platform's id and URL. No read, no `published`.

**5. X is OAuth 1.0a, and its cost is data.**
Four credentials per channel, signed per request. The cost estimate is a function of the post's shape
(link or not) and is shown in the preview, stored with the result, and surfaced on the channel. The
adapter also refuses to publish an X post when the account has no credits configured — better a clear
refusal than a 402 in a cron log.

**6. Dry run is the same code path with the network removed.**
`preview()` returns the request descriptions the real path would execute. Two implementations of "what
would be sent" drift; one implementation with a flag does not.

**7. Failure emails are plain text and actionable.**
Platform error, account, post link, one suggested action. No template with three buttons; the operator is
one person reading it on a phone.

## Risks / Trade-offs

- **Meta app restrictions** → v1 runs in Development mode against the operator's own accounts. Review
  and Business Verification are SaaS problems, explicitly deferred.
- **Instagram requires a public media URL** → M5 assumes R2 public access exists (M6 owns upload). Until
  then, publishing an image post needs media that already resolves; the adapter says so plainly.
- **Token refresh racing a publish** → refresh writes a new token and bumps `updated_at`; a publish
  holding an old token fails as `reauth_required`, not as a generic error.
- **A duplicate post after an ambiguous response** → recorded as uncertain and never auto-retried;
  `one_publish_per_variant` (partial unique index) makes a second success impossible at the database
  level.

## Migration Plan

- Apply: no schema change required beyond what M0 built; credentials rows are additive.
- Rollback: disabling the channel stops publishes without touching data; reverting the code leaves
  results recorded.
- Forward: M6 replaces local file paths with R2 keys behind the same `resolveMedia()` call.
