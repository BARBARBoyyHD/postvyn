## Why

The vault holds real work — seven queue items today, each a folder with `item.json`, a caption and
assets — and the app holds none of it. M2 closes that gap the only honest way: import the vault
verbatim, prove the import with a diff rather than a promise, then show it on a board that matches
what the vault says.

This is also the milestone that proves the schema handles real content. Until something real is
inside it, "the model fits" is an opinion.

## What Changes

- **A vault importer** that reads `brands/<brand>/social/<platform>/queue/<item>/` and writes one post
  per folder plus one variant per platform entry, **verbatim** — status, schedule and any publish
  record come across unchanged, because an import dispute is worse than an import gap.
- **Dry run is the default.** The importer prints what it would do — folders seen, rows written, and
  per-field mismatches — and refuses to commit when the diff disagrees with the source.
- **Re-runs are idempotent** on `(brand, platform, item id)`: an update, never a duplicate. The vault
  will keep changing during the migration window; the importer has to be safe to run twice.
- **Review artifacts stay non-postable**: `contact-sheet*`, `thumb*`, `preview*` land as
  `media.postable = false`, so a grid of frames can never ship as a carousel.
- **A read-only queue board**: columns by status with counts, filters by platform and pillar,
  pagination, and one batched read per view — never one query per card.
- **Post detail**: caption, hashtags, ordered media, schedule, spec verdict placeholder, and the
  `activity_log` history for that post.

No **BREAKING** changes: nothing is published from the app yet, and the vault is read-only until M6.

## Capabilities

### New Capabilities

- `vault-importer`: reading the vault, mapping folders to rows, proving the mapping with a diff, and
  staying idempotent across re-runs.
- `queue-board`: the read model — columns, counts, filters, pagination and the query budget that keeps
  it inside the free-plan D1 allowance.
- `post-detail`: what a single post shows, including the media order and the audit trail.

### Modified Capabilities

None. `m0-foundations` remains open and unarchived; `m1-identity` provides the context this reads
through, and this change adds to it rather than altering it.

## Impact

**Code**

- New: `tools/importer/` (a Node CLI, deliberately *not* a Worker route — it needs a filesystem),
  `src/app/(app)/board/`, `src/app/(app)/posts/[id]/`, `src/app/api/v1/queue/route.ts`,
  `src/app/api/v1/posts/[id]/route.ts`.
- Changed: `src/db/repository.ts` (board queries), `db/README.md` (import runbook).

**Dependencies**

- No new runtime dependencies. The importer uses Node's `fs` and the existing `better-sqlite3`-free
  path through `wrangler d1 execute --local`, or D1's HTTP API for a remote target.

**Systems**

- Reads `D:/uwi/Projetcs/Uwi's-Department` (the vault) in place. **Never writes to it** — the content
  repo stays the operator's until M6, and a migration that edits its source of truth cannot be undone.

**Explicitly not in this change**: composing or editing (M3), approval and scheduling (M4), publishing
(M5), media upload (M6). The board is read-only by design, so there is no half-built editor to explain
away.

## Open Questions carried from the docs

- OQ on duplicates: two vault folders resolving to the same `(brand, platform, item id)` — first one
  wins and the second is reported as a conflict, never silently merged.
- X cost (OQ-3) does not affect M2; the board shows cost estimates from M5.
