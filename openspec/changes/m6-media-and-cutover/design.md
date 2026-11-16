## Context

This is the last milestone, and its real deliverable is not a feature — it is **retiring the old
pipeline**. Everything before it added capability; M6 has to remove one, and removal is where projects
stall because both systems keep working.

The technical constraint is the Worker's CPU budget: no `sharp`, no `resvg`, no canvas work of any
consequence. Whatever M6 does with images must be cheap, or it happens outside the Worker.

## Goals / Non-Goals

**Goals:**

- A file uploaded once, referenced anywhere, served from a URL a platform will accept.
- No private metadata published by accident.
- The bucket stays a working set, not an archive.
- `tools/publish` frozen, the vault read-only, one week of evidence.

**Non-Goals:**

- Resizing, cropping or re-encoding. Platforms scale; doing it here costs CPU for no product gain.
- An image CDN or transformation pipeline.
- Deleting the vault. The content repo stays; only its role changes.

## Decisions

**1. Signed uploads, direct to R2.**
The Worker mints a URL and records the result; bytes never traverse it. A 9 MB video through a Worker
with a 10 ms CPU ceiling is a failed upload, not a slow one.

**2. MIME from magic bytes, verified server-side.**
The client declares; the server decides. SVG is refused by policy, not only by capability — it is a
script container that no target platform accepts as an image.

**3. EXIF is stripped before the object is public.**
The upload path removes metadata, then records the stripped size and hash. A photo of a client's office
should not publish its coordinates.

**4. Dedupe on `(workspace, hash)` — the index already exists.**
M0 created `one_media_per_hash_per_workspace` and M2 imported media against it. M6 keeps that as the
identity and makes re-upload a lookup, not a write.

**5. Cleanup is a cron job with a dry run.**
Same shape as the publish tick: a claim-free sweep that lists, then deletes, and refuses to touch
anything referenced by a variant or already published.

**6. The cutover is a written runbook plus a week.**
`docs/runbook.md` covers: connect a channel, rotate `TOKEN_ENCRYPTION_KEY`, recover a failed job, re-run
the importer, restore from a D1 export. Written for the operator at 11pm, not for a reviewer.

## Risks / Trade-offs

- **Public bucket misconfiguration** → the health page's storage check plus an explicit
  `R2_PUBLIC_BASE` requirement; publishing refuses rather than emitting a URL that 404s at Instagram.
- **A purge deleting something referenced** → the sweep checks references inside the same transaction
  that deletes, and a test asserts published media is untouchable.
- **Two pipelines running in parallel** → cutover is a calendar decision with a written exit criterion,
  not a code change. The week is the measurement.
- **Losing the vault's history** → the vault is not deleted. It stops being the source of truth; it stays
  the archive.

## Migration Plan

- Apply: `media.key` moves from a vault path to an R2 key. Imported rows keep their path until their
  object is uploaded; a migration maps old paths to new keys where the file exists.
- Rollback: the vault still holds every original file, so reverting the code loses nothing.
- Forward: v1.5 (calendar, digest) and v2 (analytics, billing) build on a system whose source of truth is
  finally in one place.
