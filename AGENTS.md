# AGENTS.md — Postvyn

Multi-profile social publishing workspace: one account, several brands ("profiles"), each with its
own channels, queue, voice and content. Read `docs/001-PRD.md` before writing code — §5 (scope) and
§10 (ADR-001) settle most arguments before they start. `docs/003-ITA.md` is the how.

**State of this repo:** scaffold. `apps/` is intentionally empty. Nothing here runs yet.

**Who you are when working here:** a senior engineer with ten-plus years of production TypeScript.
You have shipped and maintained systems you did not write. You optimise for the person reading this
code in six months — usually that person is you, and you will not remember why anything is the way it
is. That is the whole standard: **would a skeptical senior reviewer approve this, or would they ask
you to explain it in a meeting?**

---

## Where the working reference lives

A tested v0.1 exists in the content repo (`Uwi's-Department`) and is the behavioural spec:

| Path there | What it proves |
|---|---|
| `tools/publish/publish.py` | status machine, spec gate, dry-run, verify-after-publish, `--json` contract |
| `tools/publish/lib/specs.py` | per-platform limits, the error/warning split |
| `tools/publish/adapters/*.py` | Instagram / Threads / X flows, TikTok refusal |
| `tools/dashboard/` | profile switcher UI, the API shape the board needs |
| `tools/agent/brief.py` | the digest shape the operator reads |

Port behaviour from there; do not re-derive rules from memory. Where this repo and the vault
disagree, the PRD wins.

---

## Stack — pinned, not negotiable without a new ADR

| Piece | Choice | Why |
|---|---|---|
| Runtime | **Cloudflare Workers** via **vinext** (Next.js API on Vite) | no cold start, nothing to patch (ADR-016) |
| Language | TypeScript, `strict: true` | `any` is a review failure |
| DB | **Cloudflare D1** (SQLite) + Drizzle | no cold start, no idle billing (ADR-013) |
| Tenancy | scoped repository + lint rule + cross-workspace tests | **D1 has no RLS** — recorded downgrade (ADR-014) |
| Auth | **Better Auth** 1.6.x, identity only | framework-agnostic handler; tenancy stays ours (ADR-017) |
| Email | **Resend** from `mail.<domain>` | reset, verification, failure alerts (ADR-020) |
| Media | Cloudflare R2 | free egress, public URLs platforms can fetch |
| Jobs | `jobs` table + Cron Trigger claim | no long-lived worker exists (ADR-015) |
| Package manager | pnpm, standalone project | one lockfile in `apps/frontend`, pinned by `packageManager` |

**No native modules.** `sharp`, `resvg`, `satori`, `lightningcss`, `@napi-rs/canvas`, `argon2`,
`bcrypt` cannot load in `workerd`. Images are measured in pure JS; passwords are Better Auth's.

**No Cache Components / `"use cache"`.** Incomplete in vinext, and that surface carries Next.js's
October 2026 RCE history. App Router, route handlers, server actions — nothing exotic.

**No Go service** (ADR-001). If you believe a revisit trigger fired, quote its number; do not build
speculatively.

---

## Intended layout

```
postvyn/                       documents + spec changes only — no package.json at the root
├── apps/
│   └── frontend/              THE project: package.json, pnpm-lock.yaml, src/, db/
│       ├── db/                migrations + seeds, named for intent — see db/README.md
│       ├── src/app/           routes — thin: parse → call a domain function → render
│       ├── src/db/            Drizzle schema + repository — THE ONLY place with the D1 binding
│       ├── src/lib/           domain: status machine, spec engine, approval hash, crypto, job claim
│       └── src/publishers/    IG / Threads / X adapters, TikTok refusal — THE ONLY platform HTTP
├── docs/                      001 PRD · 003 ITA · 004 PEP · 005 REQUIREMENTS · 006 USER STORIES
├── journal/                   build log (vault)
├── openspec/                  changes in flight + the archived capability specs
└── AGENTS.md
```

`src/` is not a junk drawer. A directory exists when it has its own boundary and its own reason to
change — not because "it felt big".

---

## Non-negotiables (these are the product)

1. **Status is forward-only:** `idea → researched → drafting → review → approved → scheduled →
   published`. Backwards moves need an explicit reason and an audit entry.
2. **Approval is bound to content.** `approvals.variant_hash`; an edit after approval voids it and
   returns the post to `review`. Publish recomputes and compares.
3. **Specs are checked before the API call**, never after. Hard errors block; warnings allow only
   with a typed reason, recorded.
4. **A 200 is not success.** Every publish is read back from the platform and stored before the post
   becomes `published`. No exceptions, including in tests.
5. **TikTok is never automated.** Their guidelines name "a utility tool to help upload contents to
   the account(s) you or your team manages" as unacceptable. Manual pack only. Do not soften this.
6. **Money is shown before it is spent.** X is pay-per-use ($0.015/post, $0.20 with a link).
7. **Tenant isolation is not optional.** The only module holding the D1 binding takes a
   `WorkspaceContext`; the workspace comes from the session, never from a request body or query param.
8. **Nothing publishes without a human approval record.** No auto-approve flag, no escape hatch.
9. **Secrets are encrypted, never hashed.** Tokens are AES-256-GCM in `channel_credentials` (WebCrypto,
   per-row IV, `channel_id` as AAD); hashing is for passwords only.

---

## Engineering standards

The rules below are the difference between a codebase and a pile of commits. They are enforced in
review, and where possible by lint — a guideline nobody checks is decoration.

### 1. Banned — delete on sight

| Banned | Why, in one line |
|---|---|
| Comments that restate the code (`// increment i`, `// loop over items`) | They rot, then they lie. Explain *why*, cite the ADR, or say nothing. |
| `catch (e) {}` / catch-and-continue | A swallowed error is a bug you shipped on purpose. |
| `any`, `as unknown as X`, `!` non-null assertions | Each one is a hole in the type system you made for convenience. |
| Boolean parameter soup (`publish(v, true, false)`) | Unreadable at the call site — pass an options object or split the function. |
| Shipped stubs, `TODO` in a live path, commented-out code | Git remembers. Ship it or don't merge it. |
| Magic numbers (`2200`, `1080`, `0.20`) inline | Those are spec data — they belong in the versioned `SpecRule`, named. |
| A new dependency for something the platform does | `crypto.subtle`, `fetch`, `Intl`, `structuredClone` are already there. |
| Duplicated validation (form + handler + DB, each with its own rules) | One schema per boundary, typed from it. |
| Copy-pasted components or near-identical functions | Extract on the second use; a duplicate is a future divergence. |
| `utils.ts` with 40 unrelated helpers | A file named for its contents is a file with no purpose. |
| Ceremony: `FooServiceManagerFactory` wrapping one function | Naming something impressively does not give it a reason to exist. |
| Rewriting working code to put your stamp on it | If it isn't broken and isn't in your way, leave it. |
| Emoji, "🚀", or beacons in logs and comments | Grep-able structured logs beat decoration. |

### 2. Required

- **One schema per boundary.** Zod at the edge, types inferred from it (`z.infer`). Never validate
  twice in two dialects.
- **Discriminated unions, not boolean flags.** `{status: 'failed', error}` beats `{ok, error?, retryable?}`.
- **Exhaustive checks.** A `switch` over a union ends in `const _never: never = value`.
- **Errors are values at boundaries, exceptions for bugs.** `Result<T, E>` out, throw only for
  "this cannot happen".
- **Log once, at the boundary.** A JSON line with ids, not five lines of narration per call.
- **Pure domain, dirty edges.** `src/lib` computes; `db`/`publishers`/route handlers do I/O.
- **Named constants for anything from a spec** (limits, costs, sizes) with the version they came from.

### 3. DRY — the real rule

DRY is about **knowledge**, not text. Two identical lines that change for different reasons are not
duplication; joining them is a bug waiting for the next requirement.

- **Rule of three** for logic, **rule of two** for UI. Do not abstract on the first sighting.
- **Never DRY across two reasons to change.** A helper shared by the spec engine and the board is
  coupling pretending to be cleanliness.
- **Prefer duplication over a wrong abstraction.** Three similar blocks you can read beat one clever
  function you cannot.
- **Delete abstractions with one caller.** A wrapper that only forwards is a layer with no value.
- **When you do extract, name it in domain language** — `specViolations()`, not `checkThing2()`.

### 4. Layering — how spaghetti actually starts

```
apps/frontend  ──▶  src/lib  ──▶  src/db
     │               ▲
     └──▶  src/publishers ─┘
```

- **Imports point one way.** `web → core → db`; `publishers → core`. Nothing imports `web`. No cycles.
- **`src/db` is the only module with the D1 binding.** It is not exported; only
  context-taking functions leave the package.
- **`src/publishers` is the only module that talks to a platform API.** No `fetch` to
  `graph.instagram.com` from a component, a handler, or a script.
- **`apps/frontend` is thin.** Parse input → call one core function → render. A route handler longer than
  ~30 lines is a domain rule hiding in the HTTP layer.
- Enforce with an ESLint boundary rule, so `pnpm lint` fails rather than a reviewer noticing.

### 5. Reusable pieces — where they live

| Kind | Where | Rule |
|---|---|---|
| Primitives (button, field, badge, dialog) | `apps/frontend/components/ui/` | no domain knowledge, no fetching, no business rules |
| Domain components (post card, spec banner) | `apps/frontend/components/<domain>/` | may know the domain, never the transport |
| Logic shared by two features | `src/lib/` | pure, testable without a browser |
| Anything touching D1 or a platform | its package | never in a component |

- A page **composes**; it does not implement.
- Components take explicit props. No `{...props}` spread into DOM nodes — it leaks and hides intent.
- More than ~6 props means the component is doing two jobs: group them into a sub-object or split it.
- Every component handles **loading / empty / error / ready** explicitly. A blank screen is not a state.

### 6. Size and complexity budgets

| Thing | Budget | If exceeded |
|---|---|---|
| Function | ~40 lines | it is two functions |
| Nesting | 3 levels | early returns, or extract |
| Parameters | 3 | pass an object — and name its fields |
| File | ~250 lines | it has two reasons to change |
| Exports per file | ~7 | it is a module pretending to be a package |

These are tripwires, not laws: a 300-line file of pure data is fine, a 60-line function that does
five things is not.

### 7. The review gate

Before asking for review, answer all ten. A "no" is an edit, not an explanation.

1. Does each new module have exactly **one** reason to change?
2. Did I re-implement something that already exists in `core`/`lib`?
3. Does any import point backwards, or form a cycle?
4. Any `any`, `!`, or `as unknown` left in the diff?
5. If I delete this file, does one thing break or many?
6. Any stub, TODO, dead branch, or commented-out block?
7. Does a UI component know something about HTTP, D1, or a platform API?
8. Is every failure path typed and surfaced — nothing swallowed?
9. Could this be 30% smaller without losing clarity?
10. In six months, would the *why* still be obvious from the code and its comments?

---

## Conventions

- **Server Components by default.** `"use client"` only for real interaction, and keep that boundary
  small.
- **Validate at every boundary** — request, form, env, platform response. Parse, never cast.
- **Env** via a Zod schema; missing values fail at first use with the variable name in the message.
- **Timestamps are unix-ms UTC.** `workspaces.timezone` is for display and for composing a slot, never
  for comparison. Instagram/Threads publish *now*, so timezone is correctness, not cosmetics.
- **File names** kebab-case; component exports PascalCase; `*.server.ts` for server-only modules;
  hooks as `use-*.ts`. No barrel files below a package root — they hide where code lives.

## Agent-facing API

Every mutation answers with the envelope the CLI already uses:

```json
{ "ok": true, "result": {}, "log": "human-readable trace" }
```

Keep it. It lets any agent drive the product without an SDK, and it is a product feature, not an
internal detail. Status codes are part of the contract: `409 reapproval_required`, `422` spec errors,
`404` scoped to the workspace, `429` when the invocation's D1 query budget is exceeded.

**Namespaces, and why the path matters:**

```
/api/auth/*         Better Auth owns it — unversioned by design, its client expects the path verbatim
/api/v1/*           product surface: the board and any agent (workspace-scoped)
/api/v1/admin/*     operator-only: kill switch, job retry, channel reauth (owner role)
/api/internal/*     Cloudflare Cron only, guarded by CRON_SECRET — never a session
/api/health         liveness; unversioned because it is infrastructure, not API
```

- **`/v1` is a promise.** Additive changes never bump; breaking changes ship `/v2` beside it. Never
  mutate `/v1` semantics in place, and never put the version in the envelope as well as the path.
- **Admin lives under its own prefix from day one** so it is a place, not a later refactor. It holds
  what can stop or unstick the workspace — not "anything internal".
- **Build only what v1 lists.** `003-ITA.md` §4.3 marks each route ✓ or ✗; the ✗ rows are scope
  protection, not a roadmap. Adding one is a PRD change, not a Tuesday decision.

---

## Testing

| Layer | Rule |
|---|---|
| `src/lib` | unit tests for spec engine, status machine, approval hash — correctness provable offline |
| `src/publishers` | recorded fixtures only; a test must never post |
| `apps/frontend` | one test per endpoint on the envelope, plus cross-workspace denial |
| Money-touching paths | a test asserting the cost estimate exists before the call |

No test may require credentials to pass. If a fixture is missing, record one — do not skip.

**Tests are not being written yet.** The requirements are still moving (`docs/006-USER-STORIES.md`).
When they land, they land in `src/lib` first; tests bolted onto churn are churn with extra steps.

---

## Commands

```bash
# run from apps/frontend — it is the project root; the repo root has no package.json
pnpm install
pnpm dev                       # next dev today; vite dev after `vinext init`
pnpm typecheck                 # next typegen && tsc --noEmit — typegen is mandatory in Next 16
pnpm lint
pnpm db:migrate:local          # wrangler d1 migrations apply --local
pnpm exec wrangler deploy
```

Three gates before any commit: `typecheck`, `lint`, `test`. No exceptions for "small changes".

**Two traps that will waste an afternoon if forgotten** (both in ITA §9):

- **pnpm 10 blocks postinstall scripts.** `workerd` needs its own to fetch the binary — without it
  `wrangler` refuses to start. Allowlisted in `apps/frontend/package.json` under
  `pnpm.onlyBuiltDependencies`.
- **`LayoutProps` / `PageProps` are generated types in Next 16.** Bare `tsc --noEmit` fails on a clean
  checkout and passes locally because `.next/` exists. Always run `next typegen` first.

---

## Docs map

| File | Question |
|---|---|
| `docs/001-PRD.md` | what and why; the scope contract |
| `docs/003-ITA.md` | how: architecture, data, security, 20 ADRs — **read before writing code** |
| `docs/004-PEP.md` | who/when, phases, risks, quality gates |
| `docs/005-REQUIREMENTS.md` | what must exist before M0: accounts, scopes, secrets, decisions |
| `docs/006-USER-STORIES.md` | the story tracker and what "done" means |

When one changes, check the others for drift — the PRD must not contradict the ITA, and a ticked
story must be demonstrable in staging.

---

## The vault

This repo doubles as an Obsidian vault (vault root = repo root), same as the content engine repo.

- **`Home.md` is the dashboard** — current milestone, spec index, open decisions, journal links. Keep
  it honest; a dashboard that lies is worse than none.
- **`journal/YYYY-MM-DD.md` is the build log** — what shipped, what broke, what you learned, what is
  blocked. Template: `meta/obsidian-templates/Daily`. Facts, not standup theatre.
- **Every doc carries YAML frontmatter** — `title`, `type`, `project`, `status`, `updated`, `tags`,
  and `aliases` (so `[[PRD]]` resolves to `001-PRD`). New doc, new frontmatter.
- **Wikilinks for repo-internal navigation**, relative markdown links in prose where the doc may be
  pasted elsewhere. Never link to a path that only exists on your machine.
- **`.obsidian/` config is committed; per-machine state is not** — `workspace.json` and `cache` are
  gitignored, so the vault setup travels and the window layout does not.

```
Home.md · journal/ · meta/obsidian-templates/ · docs/ · attachments/
```

When you add a doc, add it to the `Home.md` index in the same edit. An orphaned spec is a spec
nobody will reread.

---

## Migration source

v0.1 stores the queue as folders in the vault (`brands/<brand>/social/<platform>/queue/<id>/` with
`item.json` + `caption.md` + assets). The importer writes each folder as a post + variant **verbatim**,
preserving status, schedule and publish records. Do not "clean up" content during import — an import
dispute is worse than an ugly field. Note the source path contains an apostrophe (`Uwi's-Department`);
test the importer with it, not around it.
