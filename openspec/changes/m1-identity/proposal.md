## Why

M0 built a floor nobody can stand on. The schema has `memberships` and `brands`, but nothing signs a
user in, nothing resolves which workspace a request belongs to, and every route would have to invent
a tenant. M1 makes the product real for one operator: sign up, get exactly one workspace with owner
rights, onboard brands, and watch the theme follow the brand.

It also installs the role guard that M4's approval gate and M5's publish path both sit behind. Adding
authorization after those endpoints exist means retrofitting it onto shipped code — which is how
"editor can publish" bugs happen.

## What Changes

- **Better Auth 1.7 wired for identity only** (ADR-017): `user`/`session`/`account`/`verification`
  tables from its CLI, framework-agnostic `auth.handler(request)` mounted at `/api/auth/*`, and a
  **per-request instance built from `env`** — a module singleton captures a dead binding on Workers.
- **Auth tables arrive as migration `0013`**, generated, not hand-written. They are the only tables
  this project does not author.
- **Email delivery** through Resend on a verified `mail.` subdomain: verification and reset links.
  Reset responses are uniform whether or not the account exists.
- **Turnstile** on signup and password reset, so the two endpoints that send mail are not free to
  abuse.
- **First signup provisions a workspace**: exactly one, with an `owner` membership, written in one
  `db.batch()` — D1 has no interactive transaction, so either both rows land or neither does.
- **Brand CRUD** with handle, voice and colour tokens; the active brand's tokens become CSS variables,
  so no component hardcodes an accent.
- **Role guard**: `viewer` < `editor` < `owner`, enforced on the endpoint (403), not only in the UI.
- **Auth events → `activity_log`**: login, failed login, reset, revoke-all. The table is already
  append-only by trigger, so the trail cannot be edited after the fact.
- **Sessions** last ~30 days, survive a browser restart, and can be revoked across every device.

## Capabilities

### New Capabilities

- `auth-sessions`: signup, verification, sign-in, session lifetime, reset, revoke-all, and the
  anti-enumeration rules that make reset safe.
- `workspace-onboarding`: what happens in the instant an account is created — one workspace, one
  owner membership, atomically.
- `brand-management`: brands as data (handle, voice, colours) and as theme (CSS variables), plus the
  active-brand switcher that scopes everything downstream.
- `authorization-roles`: who may write, who may publish, and where that is enforced.

### Modified Capabilities

None. `m0-foundations` is still open and unarchived; this change builds on it without modifying it.

## Impact

**Code**

- New: `src/auth/` (instance, session resolver), `src/app/api/auth/[...all]/route.ts`,
  `src/lib/roles.ts`, `src/lib/email/` (Resend + templates), `src/app/(app)/` route group,
  `db/migrations/0013_create_better_auth_tables.sql`.
- Changed: `eslint.config.mjs` (auth module boundary), `db/README.md`, seed set (a dev user, optional).

**Dependencies**

- Added: `@marsidev/react-turnstile` (only if the widget is used; otherwise Cloudflare's script tag).
- Already present: `better-auth` 1.7.25, `@better-auth/drizzle-adapter`, `@better-auth/cli`, `resend`,
  `zod`.

**Environment**

- First real use of `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `RESEND_API_KEY`, `EMAIL_FROM`,
  `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` — all already documented in `.env.example`.

**Explicitly not in this change**: collaborator invitations (US-010, v1.5), GitHub OAuth (D7 says
email + password only), approvals, publishing, media. Those are M3–M6.
