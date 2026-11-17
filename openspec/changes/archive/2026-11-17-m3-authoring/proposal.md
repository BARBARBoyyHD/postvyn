## Why

The board can show what the vault contains; nobody can write anything new. M3 makes the app a place to
compose, not just a mirror — and it is where the platform rules stop being prose in someone's notes and
become code that refuses a post before a human ever sees it.

The order matters: composing without validation just moves the mistake later, to the moment of
publishing, when it costs a failed post and a confused operator instead of a red field.

## What Changes

- **A composer** that creates a post (title, format, pillar) and its variants — one per target channel —
  with caption, hashtags and ordered media per platform.
- **A versioned spec engine**: each platform's limits live as data (`social/<platform>/specs.md` → a
  typed rule set), so a limit change is a data change, reviewed like any other, not a code edit
  scattered across components.
- **Platform-accurate counting**: X counts a URL as 23 characters regardless of length; Instagram's
  2,200 is a hard ceiling; Threads' 500 is its own. The counter uses the platform's rule, not
  `caption.length`.
- **Hashtag placement per platform**: Instagram wants them in the first comment, Threads and X in the
  caption, and the budget includes them either way.
- **Hard errors block, warnings allow with a typed reason.** A spec violation that the platform would
  reject is a block. A judgement call — a long caption, a missing alt text — is a warning the operator
  can override, and the override is recorded.
- **Autosave** with a 5-second debounce, so closing the laptop is not a data-loss event.
- **Duplicate a post to another platform** as a starting point, then edit the copy independently.

## Capabilities

### New Capabilities

- `spec-engine`: the per-platform rules as versioned data, the validator that applies them, and the
  verdict (`ok` / `warn` / `blocked`) stored on each variant.
- `composer`: creating and editing a post and its variants — counters, hashtag placement, media order,
  autosave, and the override path for warnings.
- `media-attachment`: attaching library media to a variant in a chosen order, with the size and
  dimension warnings each platform imposes. Upload lives in M6; this attaches what already exists.

### Modified Capabilities

None. M2's board is read-only by design; this change adds the write path it deliberately withheld.

## Impact

**Code**

- New: `src/lib/specs/` (rule data + validator + counters), `src/app/(app)/compose/`,
  `src/app/api/v1/posts/` (POST/PATCH), `db/migrations/0015_*` for override reasons if the current
  `variants` columns do not carry them.
- Changed: `src/db/repository.ts` (post and variant writes), the board's card actions, `activity_log`
  writes for every edit.

**Explicitly not in this change**: approval (M4), publishing (M5), media upload (M6). A variant
finished here sits in `drafting` or `review` and goes no further.

## Open question carried forward

The spec engine reads `social/<platform>/specs.md`, which lives in the *content* repo, not this one.
M3 imports them as data at build time or reads a committed copy — decided in design, not left to drift.
