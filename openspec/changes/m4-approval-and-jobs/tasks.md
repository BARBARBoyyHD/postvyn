## 1. Approval hash

- [x] 1.1 Implement `contentHash(variant)` over caption, hashtags-in-order and media-ids-in-order, documented as "everything that leaves the building"
- [x] 1.2 Store the hash with the approval, alongside user and time
- [x] 1.3 Recompute at claim time and refuse with `409 reapproval_required` on mismatch
- [x] 1.4 On mismatch, return the post to `review` and record the reason in `activity_log`
- [x] 1.5 Unit tests: unchanged content matches; caption edit, hashtag reorder and media reorder each break it

## 2. Approval endpoints

- [x] 2.1 `POST /api/v1/variants/:id/approve` taking a slot time, owner-only, writing the approval
- [x] 2.2 Bulk approve with per-item outcomes — one audit row per item, failures named individually — **done:** `POST /api/v1/variants/approve` is owner-only and answers per item; `/review` multi-selects review variants with one shared slot and renders each outcome (stale hash → needs re-approval, `spec_blocked` → its violations)
- [x] 2.3 Derive the job's `run_after` from the slot, never from the approval moment
- [x] 2.4 Return `404` for a variant in another workspace and `403` for an insufficient role
- [x] 2.5 Show the slot in the workspace timezone while storing unix-ms UTC

## 3. Job queue

- [x] 3.1 Claim query: one `UPDATE … RETURNING` guarded by state, with a lease timeout
- [x] 3.2 Lease expiry makes a stuck job reclaimable, incrementing attempts
- [x] 3.3 Retry with backoff up to three attempts, then terminal `failed` with the platform's message
- [x] 3.4 Record `uncertain` when a call may have succeeded, and never auto-retry it
- [x] 3.5 `awaiting_platform` state carrying what is needed to resume (container id, attempt)
- [x] 3.6 Prove it: two concurrent ticks against one due job produce one attempt (test)
- [x] 3.7 Prove it: a killed lease is reclaimed and the attempt count rises (test)

## 4. Cron entry

- [ ] 4.1 Custom Worker entry exporting `fetch` plus `scheduled`, wired into `wrangler.jsonc` `main` — **descoped** — the upload button replaces the cron path for now; a scheduled tick returns with M5/M6
- [ ] 4.2 Restore `triggers.crons` in the same commit as the `scheduled` export — never one without the other — **descoped** with 4.1: no `scheduled` export is declared, so no trigger is declared either (the M0 rule)
- [ ] 4.3 The scheduled handler authenticates nothing and trusts nothing outside its own binding — **descoped** with 4.1: `runTick` exists and is tested, it simply has no automatic caller yet
- [x] 4.4 `POST /api/internal/tick` for manual runs, guarded by `CRON_SECRET`, never by a session
- [x] 4.5 Confirm a tick with no due work is a no-op and logs nothing noisy — test landed in 406ca54: "a tick with no due work is a no-op that says nothing"

## 5. Kill switch

- [x] 5.1 Check workspace and global switches at claim time, returning a reason when blocked
- [x] 5.2 Expose the switch state on `/health` and in the app header — verified 2026-11-17: `/health` reports the global switch; the header now shows a read-only on/paused chip naming which switch is off
- [x] 5.3 Audit every change with actor and new value
- [x] 5.4 Test: queued jobs survive a pause and resume without reapproval

## 6. Visibility

- [x] 6.1 "Due in the next 24 hours" list with slot times in the workspace timezone — **done:** `GET /api/v1/jobs/due` (scoped through the post, window from `dueWindow`) and the `/review` section; times formatted with `workspaces.timezone`
- [x] 6.2 Per-post history from `activity_log`: created, edited, approved, attempts, result — **done:** post detail History lists each job as "attempt n · duration" from the 0018 columns, then the activity log; publish results (including `uncertain`) come through the same detail endpoint
- [x] 6.3 Surface `uncertain` prominently — it needs a human look, not a badge — **done:** an amber alert above the post's controls whenever a variant's publish result is `uncertain`, naming the affected platforms. The due list cannot contain one: only queued or parked jobs are due

## 7. Close-out

- [x] 7.1 Mark `US-026`…`US-035` and `US-051`/`US-052` in `docs/006-USER-STORIES.md` — verified against src/ 2026-11-17: 2 ☑ (US-026, US-030), 10 ◐
- [x] 7.2 Record the double-publish test result in the journal, with the numbers
- [ ] 7.3 Run `openspec validate m4-approval-and-jobs` and confirm the change is complete before archiving — **partial:** change validates; archiving waits until M5 fills the publisher port
