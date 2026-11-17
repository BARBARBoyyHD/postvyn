---
title: User Stories — Postvyn
type: spec
doc: stories
project: postvyn
status: draft
updated: 2026-11-17
tags: [postvyn, spec, stories]
aliases: [USER-STORIES, 006, stories]
---

# User Stories — Postvyn

**Version:** 0.3
**Date:** 2026-Nov-15
**Status:** Living document — expected to change
**Derived from:** PRD v0.1 (`001-PRD.md`), ITA v0.3 (`003-ITA.md`), PEP v0.1 (`004-PEP.md`)

> **Tests exist now.** When this file was written there were none, on purpose: scaffolding against
> stories that are still settling produces tests that encode the wrong requirements. `apps/frontend/test/`
> holds 25 test files today (spec engine, status machine, approval hash, publishers over recorded
> fixtures), and none of them needs credentials to pass. Acceptance notes below are one line each —
> enough to know when a story is done, not enough to over-fit.

---

## 1. How to use this document

| Mark | Meaning |
|---|---|
| ☐ | not started |
| ◐ | in progress (code exists, not demonstrable end-to-end) |
| ☑ | done — **merged, and demonstrable in staging against a test account** |

Rules:

- **IDs are permanent.** `US-014` never gets reused or renumbered; a dropped story keeps its row and
  moves to §10 with a reason.
- **Ticked means demonstrable**, not "code written". A story that only works on the builder's machine
  is ◐ at best.
- **One story = one row.** If a row needs an "and also…", it is two stories.
- Priority is **Must / Should / Could** (MoSCoW). Milestone codes match the PEP: `M0`…`M6`, then
  `v1.5`, `v2`.
- **Two ID spaces, deliberately.** `US-###` are user stories — a person, a want, a reason. `TS-##` are
  **platform task-stories** in §12: Tailwind, Drizzle, shadcn-pattern primitives, CI wiring. Nobody
  *wants* Drizzle; it is a means. They are tracked here because this file is the only "is it built"
  surface, but they are never allowed to masquerade as features — each one carries a **proof line**
  that ties it to something observable.
- **Doc order is not execution order.** `TS-` items sit last but run first (M0–M1); the milestone
  column decides, not the position.
- When a story changes materially, bump the version at the top and note it in §14.

---

## 2. Personas

| Persona | Who | Cares about |
|---|---|---|
| **Operator** | Uwi — runs 2+ brands, ~40 posts/month | approving a week quickly, nothing shipping unapproved |
| **Editor** | collaborator who drafts but must not publish | writing without being able to go live |
| **Agent** | Hermes / any MCP client driving the JSON API | stable verbs, honest status codes, no guessing |
| **Agency user** *(v2)* | 5–20 client brands | strict separation and per-brand history |

---

## 3. Story map

| Epic | Milestone | Stories | Must-have |
|---|---|---|---|
| E1 Identity & tenancy | M1 (+1 at v1.5) | 10 | 7 |
| E2 Import & board | M2 | 6 | 5 |
| E3 Authoring | M3 | 9 | 6 |
| E4 Approval & scheduling | M4 | 10 | 8 |
| E5 Publishing | M5 | 10 | 7 |
| E6 Media | M6 | 4 | 3 |
| E7 Agent surface | M2–M4 (+1 at v1.5) | 4 | 2 |
| E8 Later | v1.5–v2 | 5 | 0 |
| E0 Platform enablement *(TS items, §12)* | M0–M6 | 15 | 11 |
| **Total** | | **73** | **49** |

**M0 has no *user* stories** — its work is the `TS-` set in §12 (schema, scoped repository, CI, env
schema). Infrastructure has no user-visible behaviour, so it gets a task-story with a proof line
rather than a `US-` row. If M0 ever needs a `US-` story, that is scope creeping into the build.

---

## 4. E1 — Identity & tenancy (M0–M1)

| ID | Story | Acceptance (short) | Pri | M | Done |
|---|---|---|---|---|---|
| US-001 | As an operator I sign up with email and password | account created and signed in immediately; no verification email while mail is deferred | Must | M1 | ◐ |
| US-002 | As an operator I sign in and stay signed in | session survives a browser restart; expiry ~30 days | Must | M1 | ☑ |
| US-003 | As an operator I reset a forgotten password by email | single-use link, short TTL, uniform response (no account enumeration) | Must | M1 | ◐ |
| US-004 | As an operator I sign out of every device | all sessions for the user revoked immediately | Should | M1 | ☐ |
| US-005 | As an operator I get a workspace on first signup | exactly one workspace, role `owner` | Must | M1 | ☑ |
| US-006 | As an operator I create a brand with handle, voice and colours | brand saved; colours drive CSS variables live | Must | M1 | ☑ |
| US-007 | As an operator I switch brands and everything follows | board, composer and theme all filter to that brand | Must | M1 | ◐ |
| US-008 | As an editor I cannot publish or approve | 403 on both endpoints; UI hides the buttons | Must | M1 | ◐ |
| US-009 | As an operator I see auth events in the audit log | login, failed login, reset, revoke recorded | Should | M1 | ◐ |
| US-010 | As an operator I invite a collaborator as editor | invitation link, role fixed at invite | Could | v1.5 | ☐ |

---

## 5. E2 — Import & board (M2)

| ID | Story | Acceptance (short) | Pri | M | Done |
|---|---|---|---|---|---|
| US-011 | As an operator I import my existing vault queue | every folder becomes a post + variant with status, schedule and publish record intact | Must | M2 | ☑ |
| US-012 | As an operator I see a diff before the import commits | dry run reports folders seen, rows written, field mismatches; refuses on mismatch | Must | M2 | ☑ |
| US-013 | As an operator I re-run the import safely | idempotent on (brand, platform, id) — updates, never duplicates | Must | M2 | ☑ |
| US-014 | As an operator I see every post for a brand by status | columns with counts; 200 posts load under 1.5 s | Must | M2 | ◐ |
| US-015 | As an operator I filter the board by platform and pillar | filters compose; count reflects the filter | Should | M2 | ◐ |
| US-016 | As an operator I open a post and see what will ship | caption, hashtags, media, spec verdict, schedule, history | Must | M2 | ◐ |

---

## 6. E3 — Authoring (M3)

| ID | Story | Acceptance (short) | Pri | M | Done |
|---|---|---|---|---|---|
| US-017 | As an operator I create a post with title, pillar and format | post saved in `drafting` | Must | M3 | ☑ |
| US-018 | As an operator I add one variant per target platform | variants independent; media order per variant | Must | M3 | ☑ |
| US-019 | As an operator the counter counts the way the platform does | X: a URL costs 23 chars regardless of length | Must | M3 | ☑ |
| US-020 | As an operator I keep hashtags where the platform wants them | IG → first comment; Threads/X → in the caption; budget includes them | Must | M3 | ◐ — X's count leaves its hashtags out |
| US-021 | As an operator I attach media from the library | reorder for carousels; size/dimension warnings per platform | Must | M3 | ☑ |
| US-022 | As an operator a spec error blocks me before publishing | hard error names the field and blocks; warning allows with a typed reason | Must | M3 | ◐ — approve/publish never check the verdict |
| US-023 | As an operator my draft saves itself | autosave ≤5 s debounce; no lost work on refresh | Should | M3 | ◐ — refresh drops the pending save, no flush |
| US-024 | As an operator I duplicate a post to another platform | variant copied with its caption, then edited independently | Could | M3 | ☑ |
| US-025 | As an operator I see the brand's voice note while composing | voice text from the brand shown beside the editor | Could | M3 | ☑ |

---

## 7. E4 — Approval & scheduling (M4)

| ID | Story | Acceptance (short) | Pri | M | Done |
|---|---|---|---|---|---|
| US-026 | As an operator I approve a variant with a slot | approval records user + content hash + time | Must | M4 | ☑ |
| US-027 | As an operator I approve several items at once | bulk approve writes one audit row per item | Must | M4 | ☑ |
| US-028 | As an operator an edit after approval invalidates it | variant returns to `review`; publish returns 409 | Must | M4 | ◐ — mismatch resets to `review` and 409s on the token path (tested); the upload button re-approves instead |
| US-029 | As an operator a scheduled post ships with my laptop closed | cron tick claims and publishes; nothing depends on my machine | Must | M4 | ◐ — `runTick` + manual `/api/internal/tick` only; no `scheduled` entry, nothing fires unattended |
| US-030 | As an operator nothing publishes twice | two concurrent ticks, one job → one post | Must | M4 | ☑ |
| US-031 | As an operator a failed publish retries then parks | 3 attempts with backoff, then `failed` with the platform's own error | Must | M4 | ◐ — 3 attempts + backoff proven, but the terminal state is `dead`; `failed` is the uncertain state |
| US-032 | As an operator slow platform processing does not lose the post | job parks as `awaiting_platform` and resumes on a later tick | Must | M4 | ◐ — park works; nothing moves `awaiting_platform` back to `queued`, so it never resumes |
| US-033 | As an operator I can stop all publishing instantly | kill switch per workspace + global, checked at claim time; queue survives | Must | M4 | ◐ — both switches checked at claim and the queue survives (tested); no control surface for the workspace flag |
| US-034 | As an operator I can see what is due in the next 24 hours | list with slot times in my timezone | Should | M4 | ☑ |
| US-035 | As an operator every post has a readable history | append-only log: created, edited, approved, attempts, result | Should | M4 | ☑ |

---

## 8. E5 — Publishing (M5)

| ID | Story | Acceptance (short) | Pri | M | Done |
|---|---|---|---|---|---|
| US-036 | As an operator I connect an Instagram channel | token encrypted at rest; channel status `connected` | Must | M5 | ◐ — connect endpoint + encryption work for any platform, but the only connect form is X's; no Meta OAuth, tokens are minted outside the app |
| US-037 | As an operator I connect a Threads channel | same flow; tester access is enough | Must | M5 | ◐ — same gap as US-036: no Threads connect form, no Meta OAuth; credentials enter through the API only |
| US-038 | As an operator I connect an X channel | OAuth 1.0a user context; cost shown before first post | Must | M5 | ☑ |
| US-039 | As an operator I publish now, deliberately | confirmation names the platform and account first | Must | M5 | ◐ — the server requires `{platform, account}` and refuses a mismatch (tested), but the dialog renders the platform only; the account is never shown |
| US-040 | As an operator I can see exactly what would be sent | dry run prints the calls; never touches the network | Must | M5 | ◐ — the dry run is offline and the response lists the calls, but the dialog shows only the call count, not the calls |
| US-041 | As an operator I only believe it when it is verified | post read back from the platform; URL stored; status `published` only then | Must | M5 | ◐ — read-back is the only path to `published` and is fixture-tested; no live platform publish observed end-to-end |
| US-042 | As an operator TikTok gives me an upload pack, not a post | pack file + checklist; completion recorded manually | Must | M5 | ☑ |
| US-043 | As an operator I hear about a failed scheduled publish | email with platform error + link to the post | Should | M5 | ◐ — message composed and sent from the tick with error, account, link and one action (tested), but delivery is the dev outbox: Resend is deferred, no inbox has received one |
| US-044 | As an operator an expired token tells me to reconnect | channel flips to `reauth_required`; board shows it | Should | M5 | ◐ — flip + audit row tested; channels page and post detail say "reconnect required", but the board shows no channel state |
| US-045 | As an operator my Instagram/Threads tokens refresh themselves | monthly cron extends them; no manual re-auth | Should | M5 | ◐ — Instagram refresh runs on the cron tick (tested); Threads tokens are never refreshed — the pass filters `platform = instagram` |

---

## 9. E6 — Media (M6)

| ID | Story | Acceptance (short) | Pri | M | Done |
|---|---|---|---|---|---|
| US-046 | As an operator I upload an image once | dedupe by content hash; public URL returned | Must | M6 | ☐ |
| US-047 | As an operator a bad file is refused | MIME from magic bytes; SVG rejected outright | Must | M6 | ☐ |
| US-048 | As an operator my photos do not leak location | metadata stripped before upload, re-validated server-side | Must | M6 | ☐ |
| US-049 | As an operator unused media gets cleaned up | unreferenced non-postable media purged after 30 days | Could | M6 | ☐ |

---

## 10. E7 — Agent surface (cross-cutting)

| ID | Story | Acceptance (short) | Pri | M | Done |
|---|---|---|---|---|---|
| US-050 | As an agent I read the queue as JSON | `GET /api/v1/queue` returns `{ok, result, log}` in one batched read | Must | M2 | ☐ |
| US-051 | As an agent I approve and publish with the same envelope | identical verbs to the CLI; `dry_run` honoured | Must | M4 | ◐ — publish verb + envelope exist for tokens; approval is deliberately cookie-only and `dry_run` exists nowhere |
| US-052 | As an agent I get an honest status code | `/api/v1` codes stable: 401/403/404-in-workspace/409/413/422/429 | Should | M4 | ◐ — 401/403/404/409/413/422 are emitted by routes; `429` is in the vocabulary but no route returns it |
| US-053 | As an operator I get one digest instead of opening the app | daily brief: due, approved, blocked, needs-eyes — numbered for batch reply | Should | v1.5 | ☐ |

---

## 11. E8 — Later (v1.5 / v2)

| ID | Story | Acceptance (short) | Pri | M | Done |
|---|---|---|---|---|---|
| US-054 | As an operator I plan the week on a calendar | drag a post to a slot; conflicts flagged | Could | v1.5 | ☐ |
| US-055 | As an operator I see what performed | per-post reach/engagement pulled from each platform | Could | v2 | ☐ |
| US-056 | As a workspace owner I pay for a plan | Stripe checkout, plan limits enforced | Could | v2 | ☐ |
| US-057 | As an agency user I onboard a client with their own app credentials | per-tenant Meta credentials path | Could | v2 | ☐ |
| US-058 | As an agency user my clients' data cannot mix | cross-workspace tests extended to every new endpoint | Could | v2 | ☐ |

---

## 12. E0 — Platform enablement (TS-01 … TS-14)

Means, not wants. Every row here exists to make a `US-` story possible, and each carries a **proof
line**: an observable result that separates "wired up" from "I wrote the config file". If a task
cannot state a proof, it belongs in a commit message, not here.

| ID | Task-story | Proof it is actually done | Pri | M | Done |
|---|---|---|---|---|---|
| TS-01 | vinext scaffolded on Workers | `vite dev` serves the app; `vinext check` reports no gaps in code we wrote | Must | M0 | ☑ |
| TS-02 | Tailwind 4 wired to brand tokens | editing `brand.colors.accent` changes `--accent` live on the board | Must | M1 | ☐ |
| TS-03 | shadcn-pattern primitives vendored | button/field/badge/dialog live in `components/ui/`, import nothing domain-side, used by ≥2 screens | Should | M1 | ☐ |
| TS-04 | Drizzle schema + migrations | an empty local D1 becomes the full ITA §5 schema with one command | Must | M0 | ☑ |
| TS-05 | Scoped-repository chokepoint | the D1 binding is not exported; `pnpm lint` fails on a raw `db(` outside `src/db` | Must | M0 | ☑ |
| TS-06 | Cross-workspace isolation test | seed workspaces A and B, assert B is invisible from A — in `vitest-pool-workers`, not a mock | Must | M0 | ☑ |
| TS-07 | Better Auth wired | `/api/auth/*` answers; `rateLimit` table exists in D1; instance is created per request | Must | M1 | ☐ |
| TS-08 | Resend wired end-to-end | a real reset email lands in Gmail **and** Outlook from `mail.<domain>`, SPF/DKIM/DMARC passing | Must | M1 | ☐ |
| TS-09 | Turnstile wired | a signup without a valid token is rejected server-side, not just hidden in the UI | Should | M1 | ☐ |
| TS-10 | wrangler config + first deploy | `wrangler deploy` publishes to `*.workers.dev`; D1/R2 bindings and the cron show in the dashboard | Should | M0 | ◐ |
| TS-11 | CI pipeline | a push runs typecheck, lint, tests and a migration check — green, with no credentials required | Must | M0 | ◐ |
| TS-12 | Cron claim loop wired | one tick claims exactly one job; a second concurrent tick receives zero rows | Must | M4 | ☐ |
| TS-13 | R2 signed upload path | the browser PUTs to a signed URL; the object is publicly readable at `media.<domain>` | Must | M6 | ☐ |
| TS-14 | Test scaffolding | `vitest-pool-workers` runs in real `workerd` — **deliberately deferred until the stories settle** | Could | M3 | ☐ |
| TS-15 | API skeleton: `/api/v1` + admin namespace, envelope helper, status mapping | every route answers `{ok, result, log}`; a malformed body returns 400 with Zod issues, not a 500 | Must | M2 | ☐ |

**Why these were not user stories.** Tailwind, Drizzle, shadcn and the migration runner have no
user; nobody opens the product wanting them. They earn a row here because this file is the only
place that answers "is it built", and an unwired dependency is exactly the kind of thing that stays
unnoticed until M4. The proof column is what keeps them honest.

---

## 13. Explicitly not doing

| Not doing | Why |
|---|---|
| TikTok publishing automation | their Content Sharing Guidelines name this use case as unacceptable (ADR-008) |
| AI-generated captions | voice quality is the product; the tool measures, it does not write |
| Comment / DM management | v2 at the earliest; a different surface entirely |
| Mobile app | responsive web only |
| Cache Components / `"use cache"` | incomplete in vinext + the October 2026 RCE surface |
| Better Auth's organization plugin | tenancy stays ours (ADR-017) |

---

## 14. Changelog

| Date | Version | Change |
|---|---|---|
| 2026-Nov-15 | 0.1 | First cut: 58 stories across 8 epics, mapped to PEP milestones |
| 2026-Nov-15 | 0.2 | Added §12 platform task-stories (TS-01…TS-14) for Tailwind, shadcn-pattern primitives, Drizzle, auth/email wiring, CI, cron, R2. Separate ID space so a task never passes as a feature. Totals: 72 items, 48 Must. |
| 2026-Nov-15 | 0.3 | API surface versioned: `US-050/052` now name `/api/v1`, plus `TS-15` (API skeleton + envelope + status mapping). Totals: 73 items, 49 Must. |
