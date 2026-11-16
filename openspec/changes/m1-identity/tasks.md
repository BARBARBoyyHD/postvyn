## 1. Better Auth wiring

- [x] 1.1 Configure the auth instance factory: `betterAuth({ database: drizzle(env.DB, { schema }), secret: env.BETTER_AUTH_SECRET, baseURL: env.BETTER_AUTH_URL, emailAndPassword: { requireEmailVerification: true }, session: { expiresIn, updateAge } })`, built **per request** from `env`
- [x] 1.2 Mount the Web handler at `src/app/api/auth/[...all]/route.ts` as `auth.handler(request)` — no adapter, no framework glue
- [x] 1.3 Set `advanced.ipAddress.ipAddressHeaders = ["cf-connecting-ip", "x-forwarded-for"]` so rate limiting keys on the real client, not an attacker-controlled hop
- [x] 1.4 Run `@better-auth/cli generate` and commit its output as `db/migrations/0013_create_better_auth_tables.sql`
- [x] 1.5 Mirror the generated tables in `src/db/schema.ts` so queries are typed; confirm `pnpm typecheck` agrees with the SQL
- [x] 1.6 Apply `0013` locally and confirm `d1_migrations` records it, then confirm a second apply is a no-op

## 2. Email

- [ ] 2.1 Verify the `mail.` subdomain in Resend: SPF, DKIM, and a DMARC record with `p=none` and reporting — **blocked: needs a Resend account + domain** — **deferred:** Resend is out of scope for now (decision 2026-11-16); the email port stays a dev logger
- [x] 2.2 Implement the Resend sender behind a small interface (`sendVerification`, `sendReset`) so tests can assert the call without the network
- [x] 2.3 Wire verification and reset callbacks to Better Auth
- [ ] 2.4 Test a reset end-to-end into a real Gmail and a real Outlook inbox, and record where it landed (PEP R13) — **blocked: needs the verified domain from 2.1** — **deferred:** Resend is out of scope for now (decision 2026-11-16); the email port stays a dev logger
- [ ] 2.5 Fail the build when `EMAIL_FROM`'s domain has no verification record configured in this environment — not implemented yet — **deferred:** Resend is out of scope for now (decision 2026-11-16); the email port stays a dev logger

## 3. Bot defence and throttling

- [x] 3.1 Add Turnstile to the signup and reset forms; verify the token server-side via `siteverify` before any account or mail work
- [ ] 3.2 Use Cloudflare's always-pass test keys in `.dev.vars`; assert at startup that production never uses a test key — dev test keys are in `.dev.vars`; the production assertion lives in `verifyTurnstile`, not at startup
- [x] 3.3 Rate-limit signup and reset per address and per IP; return `429` without revealing account existence

## 4. Workspace provisioning

- [x] 4.1 Provision workspace + `owner` membership in one `db.batch()` on the first authenticated session after verification
- [x] 4.2 Make provisioning idempotent: replaying verification or signing in again creates nothing new
- [x] 4.3 Derive the initial workspace name from the account, editable immediately (design Q1)
- [x] 4.4 Add `resolveContext(request)`: session → user → membership → workspace → active brand → `WorkspaceContext`; refuse `401` before any repository call
- [x] 4.5 Ignore any workspace id supplied in a body or query string (the session wins) and test it

## 5. Brands and theme

- [x] 5.1 Implement brand CRUD through the repository, scoped by `WorkspaceContext`
- [x] 5.2 Validate slug uniqueness per workspace and return `409` on collision
- [x] 5.3 Two token layers: `--zavron-*` for the chrome (nav, buttons, dialogs, sign-in, footer) from `brands/zavron/brand.json`, and `--brand-*` for content surfaces only. Switching brand repaints content, never the app — both layers in `globals.css`; the app layout sets `--color-brand-accent` from the active brand
- [x] 5.4 Build the brand switcher: writes the active brand to the session (or a cookie), falls back to the first brand when the selection is stale, and changes only content surfaces — `postvyn.brand` cookie, 30 days, stale id falls back to the first brand
- [x] 5.5 Store and return the `voice` block as structured JSON; a missing block reads as empty — stored as JSON; returned as a JSON string, not parsed

## 6. Roles

- [x] 6.1 Define the action → minimum-role matrix in one module (`viewer` < `editor` < `owner`)
- [x] 6.2 Wrap mutating route handlers with the guard; an unknown action fails closed
- [x] 6.3 Return `404` (not `403`) when the target belongs to another workspace, so existence does not leak
- [ ] 6.4 Write the endpoint tests: `viewer` refused on every mutating route, `editor` refused on approve/publish, `owner` allowed — role matrix unit-tested; endpoint-level tests not written — **partial:** anonymous refusal is pinned per route in test/routes.test.ts; per-role refusal needs a session in workerd, which the suite cannot mint yet
- [x] 6.5 Enumerate mutating routes in a test so a new route that forgets the guard fails CI — `test/routes.test.ts` lists every `/api/v1` route by hand and asserts 401, the failure envelope and no content leak; adding a route without adding it here is the review trigger
  - still open: roles 6.4 — that file proves *anonymous* refusal, not `viewer`/`editor` refusal per route

## 7. Audit

- [ ] 7.1 Record sign-in, failed sign-in, password reset and revoke-all in `activity_log` with actor and outcome — sign-in, failed sign-in and brand events recorded; reset and revoke-all not wired — **partial:** sign-in, failed sign-in and brand events recorded; reset/revoke-all wait for a reset flow that does not exist
- [x] 7.2 Assert the append-only triggers still refuse updates and deletes on those rows — append-only asserted by the M0 suite, not re-asserted here

## 8. Close-out

- [x] 8.1 Mark `US-001`…`US-009` in `docs/006-USER-STORIES.md` with their real state — story marks not applied yet
- [x] 8.2 Update `docs/003-ITA.md` §7 with anything this milestone decided that it does not say — ITA §7 update not written
- [x] 8.3 Add the auth tables and the `mail.` verification result to `apps/frontend/docs/` — docs not written yet
- [x] 8.4 Run `openspec validate m1-identity` and confirm the change is complete before archiving
