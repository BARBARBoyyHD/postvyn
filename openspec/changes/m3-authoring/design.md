## Context

The app can read. M3 is the first milestone where it writes content a human authored inside it, which
makes two things load-bearing that were previously decorative: the platform rules, and the counter.

The rules already exist as prose — `social/<platform>/specs.md` in the content repo, written by hand
across several sessions. They are correct and they are not code. The constraint is to move them into the
app **without** forking them into a second source of truth that drifts.

## Goals / Non-Goals

**Goals:**

- Compose a post and its per-platform variants without touching the database by hand.
- Refuse a post the platform would refuse, before a human spends time on it.
- Count the way the platform counts, including the link rule that surprises everyone.
- Never lose typing.

**Non-Goals:**

- Approval, scheduling, publishing (M4/M5).
- Media upload (M6) — this attaches what exists and imports what the vault already recorded.
- AI caption generation. The brand voice note is shown; the writing stays human.

## Decisions

**1. Specs are data, imported once and committed.**
`social/<platform>/specs.md` is parsed into a typed rule set checked into this repo
(`src/lib/specs/platforms.ts`). The content repo stays the authoring surface; this repo carries a
generated, reviewable copy with a header naming the source and the date. Alternative — read the markdown
at build time from a path outside this repo — rejected: it makes a build depend on a sibling directory
that is not part of the repository, which is fine locally and broken in CI.

**2. A verdict is `blocked` only when the platform would reject.**
Blocking is reserved for violations with no human judgement: over the ceiling, too many media items,
missing required media. Everything else warns. Over-blocking teaches the operator to route around the
tool; under-blocking makes it useless.

**3. Overrides carry a reason and are auditable.**
A warning accepted without a reason is a warning nobody can explain later. The reason lands in
`activity_log` with the actor, and the variant records which warnings were accepted.

**4. The counter is a pure function per platform, tested against real examples.**
`countFor(platform, caption, hashtags)` returns `{ counted, ceiling, remaining }`. The X link rule (a URL
costs a fixed number of characters regardless of length) is the case that proves the design; it is a
unit test, not a hope.

**5. Autosave is a debounce plus a monotonic revision, not a save button.**
Every write carries the client's revision; the server rejects a write older than the stored one. That is
what stops a slow in-flight save from overwriting newer text — the failure mode nobody notices until
they lose a paragraph.

**6. Media attachment is by id and order, never by path.**
M2 imported `media` rows with keys and hashes. M3 references ids; M6 will replace file paths with R2
keys underneath, and the variant's order must not care which.

## Risks / Trade-offs

- **Spec drift between the two repos** → the generated copy carries the source path and a date; the
  parser is tested against the real files, and CI fails if the committed copy is older than the source
  it claims to mirror.
- **Autosave writing too often** → 5 s debounce and a revision check; the audit trail records draft
  creation and state changes, not keystrokes.
- **Warnings ignored in bulk** → accepted warnings are visible on the card, not buried in a details pane.
- **A limit changes and old verdicts become wrong** → `spec_version` is stored per variant, so an old
  verdict can be identified as old rather than silently re-interpreted.

## Migration Plan

Additive: `variants` already carries `spec_state` and `spec_version`; imported variants stay `unchecked`
until they are opened and re-validated. No backfill is required, and no imported caption is rewritten.

## Open Questions

- **Q1** — Where does the override reason live: a new `variant_overrides` table, or a JSON column on
  `variants`? Leaning table, because it is an auditable event, not a property.
- **Q2** — Should approving from the board (M4) re-run validation automatically? Leaning yes: a verdict
  older than the content is not a verdict.
