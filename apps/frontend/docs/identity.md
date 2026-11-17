# Identity: what is Better Auth's, and what is ours

## Tables

| Table | Owner | Why |
|---|---|---|
| `user` | Better Auth | identity only: id, name, email, verified flag |
| `session` | Better Auth | one row per signed-in browser; token, expiry, ip, user agent |
| `account` | Better Auth | credentials per provider; for email+password it holds the scrypt hash |
| `verification` | Better Auth | email verification and reset tokens |
| `workspaces` | ours | the tenant boundary — billing, timezone, the publishing kill switch |
| `memberships` | ours | `(user, workspace, role)` — the whole authorization model |
| `agent_tokens` | ours | bearer tokens for agents: hash only, scoped to one workspace and brand |

Better Auth was adopted for identity only (ADR-017). Its organization plugin was rejected: workspaces and
memberships are ours, and a second opinion about who may do what is how two authorization systems appear.

## The first user

Sign-up is public at `/register` and signs the new account in immediately; no verification email is
sent while mail delivery is deferred. `pnpm user:create you@example.com "Your Name" [--remote]`
remains the path for a fresh database and the first account: it writes the account with
`email_verified = 1` - someone with database access created it, so a round-trip email would be
ceremony, not verification. The first account to sign in adopts the seeded, memberless workspace as owner.

## Traps that cost time here

- Instantiate Better Auth **per request** with `env`; a module-level instance captures a dead binding.
- Mount the **Web handler** at `/api/auth/*`; the Node-style handler does not return a `Response`.
- Set `advanced.ipAddress.ipAddressHeaders = ["cf-connecting-ip", "x-forwarded-for"]` — `x-forwarded-for`'s
  first hop is attacker-controlled, so trusting it makes rate limits decorative.
- The Better Auth CLI emits **Drizzle TypeScript**, not SQL. `src/db/auth-schema.ts` is the generated
  source of truth with a provenance comment; `0013_create_better_auth_tables.sql` is hand-mirrored from it.
- A CSRF-checked POST without an `Origin` header answers `MISSING_NULL_ORIGIN` — that is the guard
  working, not a bug in the client.
