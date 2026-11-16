## Context

M0 left a schema with `memberships` and `brands` and nothing that fills them. The important
constraint is the runtime, not the auth library: a Worker isolate can outlive the binding it started
with, and D1 has no interactive transactions, so "create the account" and "provision the workspace"
cannot be two hopeful writes.

Second constraint: this is a single-operator product (D4, D7 resolved). The auth surface only has to
be good enough for one owner plus, eventually, invited editors — not for public self-serve signup. That
justifies deferring invitations to v1.5 while keeping the role model in place.

## Goals / Non-Goals

**Goals:**

- An operator can sign up, verify, sign in, stay signed in, reset, and revoke — proven by tests.
- Every authenticated request produces a `WorkspaceContext` with a brand attached; nothing downstream
  has to guess.
- The role matrix exists now, so M4/M5 endpoints inherit it instead of inventing it.
- Mail actually arrives: SPF, DKIM and DMARC on a dedicated subdomain, tested against a real inbox.

**Non-Goals:**

- Collaborator invitations (US-010 → v1.5).
- GitHub/OAuth login (D7: email + password only).
- Approvals, publishing, media — M3 onward.
- Multi-workspace per user: the model supports it, the UI does not offer it yet.

## Decisions

**1. Better Auth for identity, our tables for authorization (ADR-017).**
Better Auth owns `user`, `session`, `account`, `verification`. `workspaces` and `memberships` stay
ours, and its organization plugin is deliberately unused — it would import a tenancy model that
disagrees with ADR-014's scoping rules. Alternative: Auth.js — rejected, it is now part of Better Auth
and would be a second identity stack for no benefit.

**2. Per-request instance, never a module singleton.**
`auth` is constructed inside the handler from `env` on every request. A module-level instance captures
the binding of whichever isolate loaded it; on Workers that binding can be dead, and the failure
(intermittent 500s under load) is miserable to diagnose. Alternative: a `getAuth()` memo keyed by
binding — rejected as premature, this app does not have the request volume that needs it.

**3. Auth tables come from the CLI, as migration 0013.**
Generated, not hand-written: a hand-written guess at Better Auth's schema is a bug that surfaces as a
silent session failure. `@better-auth/cli generate` runs once, its output is reviewed, and the SQL is
committed. The CLI is on its own 1.4.x line — do not assume it matches core 1.7.x.

**4. Provisioning is one `db.batch()`.**
Workspace + owner membership in a single batch. D1 has no interactive `BEGIN…COMMIT` across awaits,
so two separate writes leave a window where an account exists with no workspace — and every later
request then fails in a way that looks like a login bug. The batch is the transaction.

**5. Roles come from a matrix, not inline comparisons.**
`ACTION → minimum role` in one module, consulted by the guard. Inline `if (role !== "owner")` per
endpoint is how a codebase ends up with three different opinions about who may publish. An unknown
action fails closed.

**6. Turnstile, because both mail-sending endpoints take an attacker-chosen address.**
Signup and reset send mail to whatever the caller types. Without a bot check, that is a free
mail-bombing primitive aimed at third parties from a verified domain — the fastest way to lose the
domain's sending reputation permanently.

**7. Uniform responses on signup and reset.**
Both answer identically for existing and non-existing addresses. Account enumeration is the
precondition for credential stuffing, and it costs nothing to prevent here.

**8. The app wears Zavron's identity; brands wear their own.**
The chrome — nav, buttons, dialogs, sign-in, footer — uses Zavron's own kit (`#ff4d12` on
`#0d0d0d`/`#1c1c1c`, straight from `brands/zavron/brand.json`), and switching brand does not repaint
it. The active brand's palette reaches **content surfaces only**: post cards, caption preview, variant
preview. Reason: the product must read as Zavron's tool. A UI that adopts the client's palette is a
white-label reseller product, and this is not one. Alternative considered — theme the whole app per
brand — rejected because the operator's own brand would then be indistinguishable from the software
making it. Consequence for M2's board: cards carry the brand accent, the board frame does not.

**9. Theme tokens follow `brand.json`, not a parallel vocabulary.**
`{accent, bg0, bg1}` is what every kit already uses, so that is what the schema accepts (`plate`
tolerated as an alias for `bg0`). Inventing `{accent, plate}` in the app would have meant two palettes
to keep in step, and the wrong one would eventually win.

## Risks / Trade-offs

- **Reset email lands in spam** (PEP R13) → dedicated `mail.` subdomain, SPF + DKIM + DMARC from day
  one, and a real-inbox test (Gmail and Outlook) before M1 is called done. A reset flow nobody receives
  is worse than no reset flow.
- **Better Auth's schema drifts from our Drizzle view** → the CLI output is the source of truth for
  those tables; `src/db/schema.ts` mirrors it and the type check catches the mismatch.
- **Provisioning on verification vs on signup** → chosen: on first authenticated session after
  verification. Provisioning at signup writes a workspace for an address that may never verify, which
  turns a typo into a phantom tenant.
- **Turnstile in local development** → Cloudflare's always-pass test keys in `.dev.vars`, never in
  production. If production inherits a test key, the bot check silently disappears; the config check
  fails the build when `ENVIRONMENT=production` and the site key is the test key.
- **The role guard is only as good as its coverage** → a mutating route that forgets to name an action
  is a hole. Mitigation: the guard is applied by the route wrapper, and a test enumerates every
  mutating route and asserts it refuses a viewer.

## Migration Plan

- **Apply:** migration `0013` adds the auth tables; nothing existing changes shape. Provisioning is
  additive. Deploy behind the existing Worker.
- **Rollback:** revert the commit and drop migration `0013`'s tables. Brands and memberships created
  during the window remain valid — they reference `user`, which is why the rollback is a revert, not a
  data surgery.
- **Forward:** M2 imports the vault and reads brands; it depends on `WorkspaceContext` and the role
  matrix, both introduced here.

## Open Questions

- **Q1** — Should the first workspace be named after the user, or ask during onboarding? Leaning: name
  it from the email's display part, editable immediately; an onboarding form before any value is
  shown is a drop-off tax on a single-user product.
- **Q2** — Session lifetime exactly 30 days idle, or 30 days absolute? Leaning idle-based, so a daily
  user is never signed out mid-work.
- **Q3** — Does the dev seed create a user with a known password? Leaning yes, guarded by
  `ENVIRONMENT !== "production"`, so the board is testable without clicking through signup every run.
