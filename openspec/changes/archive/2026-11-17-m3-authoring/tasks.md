## 1. Spec engine

- [x] 1.1 Parse each `social/<platform>/specs.md` into a typed rule set: caption ceiling, hashtag placement and budget, media count, aspect ratios, file size
- [x] 1.2 Commit the generated rule set to `src/lib/specs/platforms.ts` with the source path and generation date in its header
- [x] 1.3 Fail CI when the committed copy is older than the source it claims to mirror
- [x] 1.4 Implement `countFor(platform, caption, hashtags)` with the platform's own arithmetic, including X's fixed cost for a link
- [x] 1.5 Implement `validate(platform, variant)` returning `ok` / `warn` / `blocked` with per-field reasons
- [x] 1.6 Table-driven tests: one row per rule, using real captions from the vault as fixtures
- [x] 1.7 Fail closed for a platform with no rule set, naming the platform
- [x] 1.8 Write `spec_version` alongside `spec_state` on every validation

## 2. Composer — data

- [x] 2.1 `POST /api/v1/posts` creating a post in `drafting`, bound to the context's brand
- [x] 2.2 `PATCH /api/v1/posts/:id` for title, format, pillar, with the role guard applied
- [x] 2.3 `POST /api/v1/posts/:id/variants` adding one variant per channel, rejecting a duplicate channel
- [x] 2.4 `PATCH /api/v1/variants/:id` for caption, hashtags, media order — re-running validation on write
- [x] 2.5 Record creation and every state change in `activity_log`; keep keystroke saves out of it

## 3. Composer — editor

- [x] 3.1 Build the compose view: post fields, then one panel per variant
- [x] 3.2 Live counter per variant using `countFor`, showing remaining budget and the rule being applied
- [x] 3.3 Hashtag buckets per platform — Instagram first comment, Threads/X in caption — with the budget including them where they belong
- [x] 3.4 Show blocking errors inline and disable moving forward; show warnings with an override field
- [x] 3.5 Autosave with a 5 s debounce and a monotonic revision; a stale write is rejected, not applied
- [x] 3.6 Show the brand's voice note beside the editor (US-025)
- [x] 3.7 Duplicate a variant to another channel as an independent copy (US-024)

## 4. Media attachment

- [x] 4.1 Attach library media by id, preserving order, writing the ordered id list to the variant
- [x] 4.2 Reorder control for carousels, per variant
- [x] 4.3 Mark non-postable media as reference-only and exclude it from the publishable list — validator filters on `postable`, post detail marks `ref only`, and the media count ignores them
- [x] 4.4 Warn on aspect ratio and file size per platform; block when the count exceeds the platform maximum — aspect ratio and file size warn, the platform's media ceiling blocks (all table-tested)

## 5. Board integration

- [x] 5.1 Show the spec verdict on the card, distinguishing blocked from warned without opening it
- [x] 5.2 Add a "compose" entry point that creates a post for the active brand
- [x] 5.3 Make the board's card actions respect roles — a viewer sees no write affordance

## 6. Close-out

- [x] 6.1 Mark `US-017`…`US-025` in `docs/006-USER-STORIES.md` with their real state — verified against `src/` 2026-11-17: 6 ☑, 3 ◐ (◐ = US-020 X budget omits hashtags, US-022 no spec gate at approve/publish, US-023 no flush on refresh)
- [x] 6.2 Record in the journal which platform rule surprised us during implementation
- [x] 6.3 Run `openspec validate m3-authoring` and confirm the change is complete before archiving
