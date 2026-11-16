## 1. Standalone project and Workers scaffold

- [x] 1.1 Make `apps/frontend` self-contained: `packageManager` pinned exactly, `pnpm.onlyBuiltDependencies` covering `esbuild` and `workerd`, `pnpm-lock.yaml` committed at the app root, no workspace files above it
- [x] 1.2 Run `vinext init --platform=cloudflare` in `apps/frontend` and commit the generated Vite and Cloudflare config
- [x] 1.3 Verify `vinext check` reports no compatibility issues in code we wrote, and record any remaining "partial" notice with its reason
- [x] 1.4 Verify Tailwind styling still compiles after the Vite conversion; switch to `@tailwindcss/vite` if the turbopack CSS rule is ignored
- [x] 1.5 Keep `cacheComponents` and `partialPrefetching` explicitly `false` in `next.config.ts`, with the reason comment intact
- [x] 1.6 Confirm the `typecheck` script runs `next typegen` before the compiler, and that `pnpm dev` serves a page (not a 500) on a clean install

## 2. Schema and migrations

- [x] 2.1 Create `src/db/` with `client.ts` and `schema.ts`; hand-written SQL lives in `db/migrations/` with `migrations_dir` set in `wrangler.jsonc`, seeds in `db/seeds/`
- [x] 2.2 Define the tables for workspaces, memberships, brands, channels and channel credentials in the SQLite dialect
- [x] 2.3 Define posts, variants and media, including JSON columns stored as text with `json_extract` in mind
- [x] 2.4 Define approvals, jobs, publish results and the activity log
- [x] 2.5 Add the `one_publish_per_variant` and `one_account_per_platform` unique indexes in the migration that creates their table (0004, 0011), while those tables are still empty
- [x] 2.6 Apply the migrations to an empty local D1 with `pnpm db:migrate:local`, and confirm `d1_migrations` records each one by name
- [x] 2.7 Confirm a second apply is a no-op and that every table named in the architecture document exists in `sqlite_master`
- [x] 2.8 Give the isolation test its own two-workspace fixture (brand, channel, post each), seeded inside the test rather than in `db/seeds/` — a test fixture should not land in the developer's database

## 3. Tenancy chokepoint

- [x] 3.1 Define `WorkspaceContext` (workspace id, user id, role) in `src/lib/context.ts` as the only type the repository accepts
- [x] 3.2 Implement the repository facade in `src/db/repository.ts`: every function takes a context, and the Drizzle client is not exported from the module
- [x] 3.3 Inject the workspace id into every generated query inside the facade, never from a caller-supplied argument
- [x] 3.4 Add the `no-restricted-imports` ESLint rule forbidding `@/db/client` — and therefore the D1 binding — outside `src/db`
- [x] 3.5 Add a documented example proving the rule fires on a violation, so a future reader does not disable it

## 4. Isolation proof

- [x] 4.1 Wire `vitest` with `@cloudflare/vitest-pool-workers` and a test-specific D1 binding
- [x] 4.2 Seed workspaces A and B, each with a brand, a channel and a post
- [x] 4.3 Write the list-isolation test: A's context returns only A's rows
- [x] 4.4 Write the direct-lookup test: A asking for B's row id is treated as not found
- [x] 4.5 Write the negative control: remove the workspace filter in the facade and confirm the suite fails
- [x] 4.6 Add a test asserting the facade cannot be called without a context (compile-time and runtime guards)

## 5. Worker configuration and first deploy

- [x] 5.1 Add `wrangler.jsonc` in `apps/frontend` — the Worker's build root — with the D1 and R2 bindings, using the names confirmed in design Q1
- [x] 5.2 Record why M0 ships no cron trigger (the entry exports no `scheduled`), and defer trigger + handler to M4 together
- [x] 5.3 Add `/api/health` returning liveness and D1 reachability, unversioned as designed
- [ ] 5.4 Deploy to `*.workers.dev` and confirm the Worker responds and the bindings appear in the dashboard — **blocked: needs Cloudflare credentials (`wrangler login`)**
- [x] 5.5 Confirm no secret value appears in `wrangler.jsonc`, and document every required secret in the app README
- [x] 5.6 Keep `db/README.md` current: the naming convention, the four commands, and the rule that an applied migration is immutable

## 6. CI gates

- [x] 6.1 Add a workflow that installs with `pnpm install --frozen-lockfile` **in `apps/frontend`**, then runs typecheck, lint and tests on push and pull request
- [x] 6.2 Add a migration check that runs `pnpm db:check` before applying, then applies to a throwaway database and fails on invalid SQL
- [x] 6.3 Add a re-runnability check: apply the migrations twice and assert the second run changes nothing
- [x] 6.4 Add an audit gate over runtime dependencies only, so a dev-tooling advisory is reported but not fatal
- [ ] 6.5 Confirm the whole pipeline passes on a clone with no secrets configured — **blocked: needs the first push to GitHub**
- [x] 6.6 Cache the pnpm store so the pipeline finishes in a reasonable time through the corporate proxy

## 7. Close-out

- [x] 7.1 Update `docs/003-ITA.md` — the layout, §9 dev commands and the Workers Builds topology — so it describes a single project, not a workspace
- [x] 7.2 Update `AGENTS.md`'s layout diagram and component table to match the single-project structure
- [x] 7.3 Mark `TS-01`, `TS-04`, `TS-05`, `TS-06`, `TS-10`, `TS-11` in `docs/006-USER-STORIES.md` with their real state
- [x] 7.4 Add a journal entry recording what the build taught, including any trap worth remembering
- [x] 7.5 Run `openspec validate m0-foundations` and confirm the change is complete before archiving
