## Context

M4 is the first milestone that can do damage in public. A post that ships twice, or ships content
nobody approved, is worse than a post that never ships — so this design optimises for *provable
restraint* over throughput, which the product's actual volume (~15 posts/week) easily allows.

The runtime shapes everything: a Worker cannot outlive a request, D1 has one writer and no
`SKIP LOCKED`, and a cron tick is the only thing guaranteed to run when nobody is looking.

## Goals / Non-Goals

**Goals:**

- Publish exactly once, provably, under concurrent ticks.
- Publish exactly what was approved, provably, after any number of edits.
- Survive a platform that takes minutes to process a container.
- Stop everything in one action without losing queued work.

**Non-Goals:**

- The adapters themselves (M5). This is tested against a stub publisher.
- Throughput. If 15 posts a week ever became 15,000, the claim query and the lease change; the
  guarantees do not.
- Real-time UI. A 5-minute tick is fine for content that was scheduled yesterday.

## Decisions

**1. The approval hash is computed from the publishable content only.**
`sha256(caption ‖ hashtags-in-order ‖ media-ids-in-order)`. Not the title, not the pillar: those do not
leave the building. Media *order* is included, because a reordered carousel is different content.

**2. Verification happens twice: at approve, and again at claim.**
An approval that was valid an hour ago says nothing about the row now. The claim-time check is the one
that actually protects the operator; the approve-time check catches the mistake early enough to be
useful.

**3. One statement claims a job.**
`UPDATE … WHERE id = (SELECT …) AND state = 'queued' RETURNING *`. D1's single writer serialises it.
Zero rows means someone else won — not an error, the normal case under concurrency. This is the whole
locking story, and it is written down as such (ADR-015).

**4. `awaiting_platform` is a state, not a sleep.**
A Worker cannot sleep for 30 seconds, and a cron tick every five minutes is exactly the right cadence
for container polling. The job stores what it needs to resume (container id, attempt) so the next tick
continues rather than restarts.

**5. Retries are bounded and recorded; ambiguity is not retried.**
Three attempts with backoff, then `failed` with the platform's own message. The dangerous case is a
request whose response was lost: it becomes `uncertain`, is surfaced to the operator, and is never
auto-retried — a duplicate post is worse than a manual check.

**6. The kill switch is checked at claim, not at enqueue.**
Enqueue-time checks leave a window where queued work still fires after someone hits stop. Claim-time
checks make "stop" mean "nothing starts from this moment", which is what an operator means by it.

**7. The cron trigger returns in this change.**
M0 shipped without one deliberately: the Worker entry exported no `scheduled`, so a trigger would have
failed every five minutes. Here a custom entry exports `scheduled`, and the trigger is declared in the
same commit. Trigger and handler are never separated again.

## Risks / Trade-offs

- **A cron tick that dies mid-publish** → the lease expires and the job is reclaimable; the attempt count
  prevents a poison job from spinning, and the ambiguous case lands in `uncertain`, not in a retry.
- **Clock skew on `run_after`** → all comparisons are server-side unix milliseconds; the client never
  decides what is due.
- **Bulk approve masks a broken item** → the batch reports per-item outcomes rather than a single status.
- **A kill switch nobody tests** → its state is surfaced on `/health`, which is looked at far more often
  than a settings page.

## Migration Plan

- Apply: `jobs`, `approvals` and `publish_results` already exist from M0. This change adds behaviour and
  possibly an index; no data migration.
- Rollback: turning the switch off is the rollback for behaviour. Reverting the code leaves queued rows
  intact and resumable.
- Forward: M5 fills in the publisher port that M4's stub already defines.
