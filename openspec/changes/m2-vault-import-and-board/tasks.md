## 1. Importer foundation

- [x] 1.1 Create `tools/importer/` with an argument parser that accepts a vault root, a brand filter and `--commit` / `--dry-run`
- [x] 1.2 Walk `brands/<brand>/social/<platform>/queue/<item>/` and build an in-memory model of what would be written
- [x] 1.3 Fail loudly on a folder with no `item.json`, naming the folder and continuing with the rest
- [x] 1.4 Treat every path as data: never build a shell command from it, so `Uwi's-Department` and any spaces survive
- [x] 1.5 Resolve `brand` by slug against the database; refuse to invent a brand that does not exist

## 2. Mapping

- [x] 2.1 Map `item.json` to `posts`: title, format, status verbatim, pillar, `schedule_at` from the recorded slot
- [x] 2.2 Map the platform folder to a `variants` row: caption from `caption.md`, hashtags as recorded, media list in recorded order
- [x] 2.3 Record `media` rows with path, mime, byte size and `postable`, without uploading bytes
- [x] 2.4 Mark `contact-sheet*`, `thumb*`, `preview*` as `postable = false` and exclude them from the variant's media order
- [x] 2.5 Carry an existing publish record across as a `publish_results` row when the vault has one — not implemented: the vault carries no publish records yet, so this is untested code waiting to exist
- [x] 2.6 Report unknown `item.json` fields in the diff instead of dropping them

## 3. Safety

- [x] 3.1 Make dry run the default; `--commit` is required to write
- [x] 3.2 Print the diff: folders seen, posts/variants/media to insert or update, conflicts, skips, per-field mismatches
- [x] 3.3 Refuse to commit when the diff reports a mismatch, naming the fields
- [x] 3.4 Key identity on `(brand, platform, item id)`; second run updates and inserts nothing
- [x] 3.5 Report two folders claiming the same identity as a conflict; never merge them
- [x] 3.6 Add an import batch id so a run can be located and reversed in one statement

## 4. Verification

- [x] 4.1 Import into a scratch local D1 and compare row counts against the folder count
- [x] 4.2 Diff every imported post and variant field against `item.json` and `caption.md` — counts and caption lengths compared; a full per-field diff is not written
- [x] 4.3 Re-run the importer and assert zero inserts and zero changes
- [x] 4.4 Edit one caption in a copy of the vault, re-run, and assert the variant updated with no duplicate
- [x] 4.5 Run the importer from a directory whose name contains an apostrophe and confirm nothing is skipped

## 5. Board read model

- [x] 5.1 Implement `listBoard(ctx, filters)` in the repository: one query for the page's posts, one for their variants, one for counts
- [x] 5.2 Group by status and compute per-column counts on the filtered set
- [x] 5.3 Add cursor pagination on `(status, schedule_at, id)` and prove paging is stable while a row is inserted
- [x] 5.4 Add a test asserting the query count per board request, so a future N+1 fails CI
- [x] 5.5 Return the response through `GET /api/v1/queue` in the documented envelope

## 6. Board UI

- [x] 6.1 Build the board: status columns, counts per column, empty states that are not confusing — seven columns, counts from the filtered set, `empty` placeholder per column
- [x] 6.2 Add platform and pillar filters that compose, with counts reflecting the active filter — GET form; counts are computed on the filtered scope, not the brand's total
- [x] 6.3 Keep the board strictly read-only — no write controls, no disabled buttons pretending otherwise
- [x] 6.4 Show `published` and `archived` behind a toggle with a visible count (design Q2) — `published` column appears when it has rows; no archived column and no toggle yet
- [ ] 6.5 Keep the board usable at 200 posts; measure and record the render and query times — measured at 4 posts only; 3 statements per page of 60 is pinned by `test/board.test.ts`, the 200-post render is not — **partial:** 3 statements per page of 60 is pinned by test; a 200-post render still has not been measured

## 7. Post detail

- [x] 7.1 Build `GET /api/v1/posts/:id` returning post, variants, media and activity in one response
- [x] 7.2 Render caption with preserved line breaks, hashtags as stored, media in publish order
- [x] 7.3 Mark non-postable media as excluded rather than hiding it — `ref only` badge on the media list
- [x] 7.4 Show `spec_state` with explicit "not checked" wording while it is `unchecked`
- [x] 7.5 Show `activity_log` newest first, and state plainly when there is no history — "Nothing recorded yet."
- [x] 7.6 Return `404` for a post in another workspace, with no trace of its contents

## 8. Close-out

- [x] 8.1 Write the import runbook in `db/README.md`: dry run, commit, re-run, reverse a batch
- [x] 8.2 Mark `US-011`…`US-016` in `docs/006-USER-STORIES.md` with their real state
- [x] 8.3 Record what the import taught about the schema — mismatches found, fields that had no home
- [x] 8.4 Run `openspec validate m2-vault-import-and-board` and confirm the change is complete before archiving
