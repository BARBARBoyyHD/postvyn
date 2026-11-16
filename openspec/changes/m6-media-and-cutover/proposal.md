## Why

Every adapter so far assumes a public URL exists. M6 makes that true — and then retires the thing this
project was built to replace.

The hard part is not uploading bytes; it is that a platform fetches the file itself, so anything uploaded
becomes publicly reachable. That makes MIME validation, metadata stripping and deduplication safety
features rather than polish.

## What Changes

- **Signed uploads to R2**: the browser asks for a signed URL, uploads directly, and the Worker records
  the result. No image bytes pass through the Worker, which keeps it inside the CPU budget.
- **MIME decided by magic bytes, not by extension.** An `.svg` is refused outright: SVG is a script
  container, and no social platform accepts it as a photo.
- **Metadata stripped before the object is public.** GPS coordinates in a phone photo are a privacy leak
  with a public URL attached.
- **Deduplication by content hash**: the same file uploaded twice is one object, one row, one URL.
- **Public serving** through a dedicated hostname, with `R2_PUBLIC_BASE` set so the publisher can build
  URLs the platforms will accept.
- **Hygiene**: non-postable imports and orphans are purged on a schedule, so the bucket does not quietly
  become an archive of working files.
- **Cutover**: one full week shipped from the app, then `tools/publish` is frozen. The runbook for
  connecting a channel, rotating a token and recovering a failed job is written for the operator, not for
  a developer reading the source.

## Capabilities

### New Capabilities

- `media-upload`: the upload path, what is accepted, what is stripped, and how duplicates collapse.
- `media-hygiene`: what gets deleted, when, and how the app proves it deleted the right thing.

### Modified Capabilities

None. M2 imported media rows; this manages objects behind them.

## Impact

**Code**

- New: `src/app/api/v1/media/` (list, mint signed URL, record), `src/lib/media/` (magic bytes, EXIF strip,
  hashing), `src/lib/r2.ts`, `docs/runbook.md`.
- Changed: `media.key` becomes an R2 key rather than a vault path; `R2_PUBLIC_BASE` becomes required for
  publishing; the health page gains a storage check that already exists.

**Explicitly not in this change**: image resizing or re-encoding. `sharp` and `resvg` do not load in
`workerd`, and a canvas-based resize in a Worker is a CPU trap. Images are validated and stored as-is;
platforms do their own scaling.

## The cutover, stated plainly

Success is not "the feature shipped". It is: **one full week of real posts published from the app, with
`tools/publish` untouched, and the vault read-only.** Anything less and both systems stay live, which is
how two sources of truth are born.
