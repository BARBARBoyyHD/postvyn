## ADDED Requirements

### Requirement: The project installs reproducibly with pnpm

`apps/frontend` SHALL be a self-contained pnpm project — its own `pnpm-lock.yaml`, its own
`packageManager` pin — so that a local install, CI and a Cloudflare Workers Build resolve
identically from one directory.

#### Scenario: Fresh clone installs in place

- **WHEN** a developer clones the repository and runs `pnpm install` in `apps/frontend`
- **THEN** every dependency resolves from `apps/frontend/pnpm-lock.yaml`
- **AND** no `package-lock.json` and no `pnpm-workspace.yaml` exist anywhere in the tree

#### Scenario: Package manager version is pinned where the install happens

- **WHEN** the build reads `apps/frontend/package.json`
- **THEN** `packageManager` names an exact pnpm version (no range)
- **AND** the lockfile records that same major version

#### Scenario: A frozen install succeeds on a clean machine

- **WHEN** `pnpm install --frozen-lockfile` runs against the committed lockfile
- **THEN** it completes without modifying the lockfile
- **AND** a lockfile missing from the tree fails the build rather than silently resolving fresh

### Requirement: The app builds for Cloudflare Workers via vinext

The app SHALL be deployable to Cloudflare Workers through vinext, and every dependency the project
actually uses MUST be reported compatible by the vinext compatibility check.

#### Scenario: Compatibility check reports no gaps in our code

- **WHEN** `vinext check` runs in `apps/frontend`
- **THEN** it reports zero issues for the App Router structure and every library we import
- **AND** any remaining "partial" notice is limited to features this project refuses to use

#### Scenario: Local development keeps working during the transition

- **WHEN** a developer runs `pnpm dev`
- **THEN** the application serves its page in a browser
- **AND** the command used is documented as `next dev` before `vinext init` and `vite dev` after

#### Scenario: Turbopack resolves the framework it is running

- **WHEN** `pnpm dev` starts in a directory whose pnpm store is its own `node_modules/.pnpm`
- **THEN** the first request returns a page rather than a 500
- **AND** no `turbopack.root` override is needed, because the store is inside the app directory

### Requirement: Framework features that are forbidden stay disabled

Cache Components and Partial Prefetching SHALL be explicitly disabled in `next.config.ts`, because
vinext supports them only partially and `"use cache"` is the surface behind the October 2026 Next.js
remote-code-execution advisories. A framework default MUST NOT silently enable them.

#### Scenario: Production build does not enable Cache Components

- **WHEN** a production build runs
- **THEN** the build output does not report "Cache Components enabled"
- **AND** `next.config.ts` contains an explicit `cacheComponents: false` with the reason recorded
  next to it

### Requirement: Type checking works on a clean checkout

The type-check command SHALL generate framework route types before running the compiler, because
Next 16 supplies `LayoutProps` and `PageProps` as generated types rather than imports.

#### Scenario: Typecheck passes without a previous build

- **WHEN** a developer deletes `.next/` and runs the type-check script
- **THEN** the script generates route types first and type checks cleanly
- **AND** a bare `tsc --noEmit` is not used as the gate

### Requirement: Native build scripts required by the toolchain are allowlisted

Packages that must run a postinstall step to fetch a platform binary SHALL be allowlisted under
`pnpm.onlyBuiltDependencies` in `apps/frontend/package.json`, because pnpm 10 blocks lifecycle
scripts by default.

#### Scenario: Wrangler can start after a fresh install

- **WHEN** a developer runs `pnpm install` and then invokes wrangler
- **THEN** `workerd` has completed its postinstall and wrangler reports its version
- **AND** dev-only native packages that are not needed to run the app remain unbuilt

### Requirement: Worker configuration declares its bindings

`wrangler.jsonc` SHALL declare the D1 and R2 bindings, and a first deploy MUST succeed against
`*.workers.dev`.

The cron trigger SHALL be added together with a Worker entry that exports a `scheduled` handler —
never before it. The M0 entry is the framework's fetch handler and exports no `scheduled`, so a
trigger declared now would fail on every invocation, and a scheduled failure every five minutes is
worse than no schedule. Trigger and handler both land in M4, when there are jobs to claim.

#### Scenario: First deploy proves the configuration

- **WHEN** the deploy command runs against a configured Cloudflare account
- **THEN** the Worker is published and reachable
- **AND** the D1 and R2 entries appear in the deployed Worker's configuration
- **AND** no cron trigger is declared until a `scheduled` handler exists to receive it

#### Scenario: Secrets are not configuration

- **WHEN** the Worker configuration file is inspected
- **THEN** it contains no secret value
- **AND** every secret is supplied through the platform's secret mechanism
