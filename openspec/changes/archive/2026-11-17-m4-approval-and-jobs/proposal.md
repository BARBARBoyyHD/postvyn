## Why

Everything so far is preparation. M4 is the milestone where a post can actually leave the building —
which means this is where the two promises the product is built on get enforced by code rather than by
intention: **a human approved exactly this content**, and **it ships once**.

Both promises fail in the same way if left to care: a stale approval, or two ticks picking up the same
job while the operator's laptop is closed.

## What Changes

- **Approval bound to a content hash.** The approval records the hash of caption, hashtags and media
  order. Publishing recomputes it; a mismatch returns the post to `review` and the publish call answers
  `409 reapproval_required`. Editing after approval voids it — silently, immediately.
- **Bulk approve** that writes one audit row per item, because "I approved 12 things at 09:04" is
  auditable and "12 rows with the same timestamp" is not.
- **A durable job queue** in the existing `jobs` table: a single-statement claim guarded by state, a
  lease with an expiry, and retries with backoff. D1's single writer makes the claim atomic without
  `SKIP LOCKED`.
- **A Cron Trigger handler** that runs the claim loop, so publishing never depends on anyone's machine
  being awake.
- **`awaiting_platform`** as a first-class state: Instagram processes containers asynchronously, and a
  Worker cannot wait. A job that is mid-platform parks, and a later tick resumes it.
- **A kill switch**, per workspace and global, checked at claim time. Queued work survives; nothing new
  starts.
- **Dead-lettering**: three attempts, then `failed` carrying the platform's own error text — not a
  generic "something went wrong".

## Capabilities

### New Capabilities

- `approvals`: what an approval binds to, how editing invalidates it, and how a batch is recorded.
- `job-queue`: claiming, leasing, retrying and parking work — the machinery that makes a Worker able to
  publish at all.
- `publishing-switch`: the two-layer kill switch and what it does and does not stop.

### Modified Capabilities

None. M3 left variants in `drafting`/`review`; this change is the only thing that moves them further.

## Impact

**Code**

- New: `src/lib/approval.ts` (hashing), `src/lib/jobs/` (claim, lease, retry), `src/worker/cron.ts`
  and the custom entry that exports `scheduled`, `src/app/api/v1/variants/[id]/approve/`,
  `src/app/api/internal/tick/`.
- Changed: `wrangler.jsonc` — **the cron trigger returns here**, now that a `scheduled` export exists
  (the M0 change deliberately shipped none).
- Changed: `variants` state transitions, `publish_results` writes.

**Explicitly not in this change**: the platform adapters themselves (M5). The job queue is built and
tested against a stub publisher, so the concurrency guarantees are proven before any network exists.

## Open question carried forward

Does approval set the schedule, or does scheduling happen separately? US-026 says "approve a variant
with a slot" — so approval carries a slot time, and the job's `run_after` is derived from it.
