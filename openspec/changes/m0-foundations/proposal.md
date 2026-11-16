## Why

Every spec, story and decision for Postvyn exists; nothing runs. M0 builds the floor the rest
of the product stands on: a Workers-native scaffold, the full SQLite schema, the tenancy chokepoint
that replaces the row-level security D1 cannot give us, and a CI that proves migrations and
cross-workspace isolation on every push. Without it, M1 (identity) and M2 (board) have nowhere to
land, and the one guarantee that got weaker in the Cloudflare pivot — tenant isolation — would never
get the compensating control it was promised.

## What Changes

- **`apps/frontend` becomes a standalone pnpm project**, not a workspace member: its own
  `pnpm-lock.yaml`, its own `packageManager` pin, and `pnpm.onlyBuiltDependencies` in its
  `package.json` so `workerd` can fetch its binary. The repository root holds documents only.
- **The app is made Workers-capable** via `vinext init --platform=cloudflare` (ADR-016), keeping
  `next dev` working alongside `vite dev`. Cache Components and Partial Prefetching are explicitly
  disabled — they are `next.config` defaults in Next 16 and both are forbidden here.
- **`src/db` is created**: Drizzle schema for every table in ITA §5, SQLite dialect, with plain-SQL
  migrations applied through `wrangler d1 migrations`.
- **`src/db/repository.ts` becomes the tenancy chokepoint**: a `WorkspaceContext` every query
  requires, `client.ts` as the only module that touches the D1 binding, and an ESLint boundary rule
  that fails a raw `db(` call outside `src/db`.
- **A cross-workspace isolation test** becomes the M0 exit gate: seed workspaces A and B, assert B is
  invisible from A — run in `vitest-pool-workers` against real `workerd`, not a mock.
- **`wrangler.jsonc`** declares the D1 and R2 bindings and the cron trigger, and a first deploy to
  `*.workers.dev` proves the config is real.
- **CI** runs typecheck, lint, tests and a migration check on every push, with no platform
  credentials required.

No **BREAKING** changes: the repository has no users, no data and no deployed surface.

## Capabilities

### New Capabilities

- `project-scaffold`: the project layout, package management, Workers build path and the
  build/typecheck/lint commands that every later change depends on.
- `database-schema`: the persisted model — tables, keys, indexes and migrations — for identity
  boundaries, brands, channels, posts, variants, media, approvals, jobs and the audit log.
- `workspace-tenancy`: how a workspace's rows are kept apart in a database that has no RLS: the
  required context, the single access path, and the tests that prove the boundary holds.
- `ci-pipeline`: the automated gates that decide whether a change is mergeable, and what they are
  allowed to need (no secrets, no live platform accounts).

### Modified Capabilities

None. This is the first change in the repository; `openspec/specs/` is empty.

## Impact

**Code**

- New: `apps/frontend/src/db/` (`client.ts`, `schema.ts`, `repository.ts`, `seed.ts`),
  `apps/frontend/src/lib/context.ts`, `apps/frontend/db/{migrations,seeds}/`, `apps/frontend/wrangler.jsonc`,
  `openspec/specs/{project-scaffold,database-schema,workspace-tenancy,ci-pipeline}`.
- Changed: `apps/frontend/package.json`, `apps/frontend/next.config.ts`, `apps/frontend/eslint.config.mjs`,
  new `apps/frontend/wrangler.jsonc`, new `.github/workflows/ci.yml`.
- Removed: the workspace root `package.json`, `pnpm-workspace.yaml` and `pnpm-lock.yaml` — the app is
  self-contained, so a lockfile at the repository root would be a second, unused source of truth.

**Dependencies**

- Added at M0: `vinext`, `vite`, `@vitejs/plugin-react`, `@vitejs/plugin-rsc`,
  `react-server-dom-webpack`, `vitest`, `@cloudflare/vitest-pool-workers`.
- Already present and unchanged: `next`, `drizzle-orm`, `drizzle-kit`, `wrangler`, `zod`,
  `better-auth`, `resend`.

**Systems**

- Cloudflare: one D1 database (local + staging), one R2 bucket binding, no cron firing yet. The
  Worker's build root is `apps/frontend`, which now matches the directory holding the lockfile.
- No user-facing behaviour changes; no publishing, no auth, no board. The app still renders the
  scaffold page.

**Explicitly not in this change**: authentication (M1), the queue board and importer (M2), the
composer (M3), approvals and jobs (M4), publishers (M5), media uploads (M6).
