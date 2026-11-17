## Context

The vault is a real, working content pipeline: seven item folders across two brands, each with
`item.json`, a caption and assets. The app now has a schema that can hold them and no data. M2 is the
milestone where the app has to agree with reality instead of with a design document.

Two constraints shape everything here. **The importer needs a filesystem**, which a Worker does not
have — so it is a Node CLI, not a route. And **D1 bills reads per invocation**, so a board that looks
fine locally can still be unusable on the free plan if it queries per card.

## Goals / Non-Goals

**Goals:**

- Import the vault verbatim, with a diff that a human can check against the folder.
- Be safe to run twice, because the vault will keep changing while the migration is in progress.
- A board that shows the operator their real queue, fast enough to use daily.
- A post view that never implies "spec-checked" when nothing checked it.

**Non-Goals:**

- Editing, composing, approving, publishing (M3–M5).
- Writing anything back to the vault. The content repo is read-only until M6 — a migration that edits
  its own source cannot be rolled back.
- Media upload to R2 (M6); M2 records media rows and paths, not uploaded bytes.

## Decisions

**1. The importer is a Node CLI in `tools/importer/`, not a Worker route.**
It reads a directory tree and file contents. A Worker has no filesystem, and faking one with an upload
endpoint would mean the operator uploading their vault to import it — more work, more risk, worse
ergonomics. The CLI runs where the files are.

**2. Dry run is the default; `--commit` is explicit.**
The blast radius of a wrong import is "the database disagrees with the vault and nobody noticed".
Making the destructive path the explicit one costs a flag and buys a review step.

**3. Identity is `(brand, platform, item id)`, not the folder path.**
Paths move — folders get renamed, brands get reorganised. The item id is stable, and it is what the
vault already uses to thread an item through image jobs, video scripts and social queues.

**4. Verbatim, including the things the app would do differently.**
Statuses come across as recorded, including ones the app will later advance. Hashtags stay as written.
The importer's job is fidelity; the app's opinion starts in M3. An import that "improves" content
silently is an import nobody can verify.

**5. The board reads once, then shapes in memory.**
One query for the page's posts, one for their variants, one for counts. Grouping by status, counting,
and filtering happen in the Worker, not in a per-status loop. The alternative — a query per column —
is four to nine round trips for a screen that shows twenty cards.

**6. Cursor pagination on `(status, schedule_at, id)`.**
Offset pagination over a table that is being written to will duplicate or skip cards. The cursor makes
paging stable while the importer is still landing rows.

**7. `postable = false` for review artifacts, decided at import, enforced at publish.**
`contact-sheet*`, `thumb*`, `preview*` are working files. The importer knows that from the filename;
M5's publisher will trust the flag rather than re-deriving it. One place decides, one place obeys.

**8. The post view says "unchecked" out loud.**
`spec_state` starts at `unchecked` and the UI states it. Rendering an unchecked variant with a neutral
look would teach the operator that green means nothing, which is the exact habit the human gate exists
to prevent.

## Risks / Trade-offs

- **The vault changes mid-migration** → idempotent identity + re-runnable import; the runbook says
  "re-run after the vault changes, before M3 starts".
- **A pathological folder (no `item.json`, unknown platform)** → reported in the diff and skipped, never
  guessed. An import that invents a brand is worse than one folder left behind.
- **Query budget on the free plan** → a test asserts the query count per board request; if M3 needs
  more, the response shape changes, not the budget.
- **`Uwi's-Department` contains an apostrophe** → the importer receives paths as arguments and never
  builds a shell string; a test imports from a directory whose name contains a quote.
- **Duplicate folders after a rename** → reported as a conflict; the operator resolves it, the tool
  does not choose.

## Migration Plan

- **Apply:** `--dry-run` first, read the diff, then `--commit`. Nothing in the vault is touched.
- **Rollback:** imports are additive rows; deleting rows by `(brand, platform, item id)` reverses one
  run. The vault is untouched, so the rollback path is always available.
- **Forward:** M3's composer edits these rows; M6 replaces file paths with R2 keys. Neither needs the
  importer re-run.

## Open Questions

- **Q1** — Should imported posts record an `import_batch` id, so a bad run can be undone in one
  statement? Leaning yes: cheap now, archaeology later.
- **Q2** — Does the board show `published` and `archived` by default, or behind a toggle? Leaning
  hidden by default, with a count so nothing looks lost.
- **Q3** — Where does the importer read its target from: `wrangler d1 execute --local`, or D1's HTTP
  API? Leaning local first (no credentials), with the HTTP path added when staging exists.
