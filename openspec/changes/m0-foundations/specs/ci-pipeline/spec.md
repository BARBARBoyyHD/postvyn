## ADDED Requirements

### Requirement: Every push runs the merge gates

Continuous integration SHALL run type checking, linting, the test suite and a schema migration check
on every push and pull request.

#### Scenario: A push triggers all gates

- **WHEN** a commit is pushed
- **THEN** the pipeline runs type check, lint, tests and the migration check
- **AND** a failure in any gate fails the pipeline

#### Scenario: A gate failure blocks the merge

- **WHEN** any gate fails
- **THEN** the pipeline reports failure on the commit
- **AND** the failure names the gate that failed

### Requirement: CI needs no credentials and never touches a live platform

The pipeline SHALL complete without social platform credentials, without a Cloudflare token and
without contacting Instagram, Threads or X. Adapter behaviour is exercised against recorded fixtures
only.

#### Scenario: Pipeline runs on a fresh clone with no secrets

- **WHEN** the pipeline runs on a repository with no secrets configured
- **THEN** every gate completes
- **AND** no request is made to a social platform host

### Requirement: Migrations are applied in CI against a throwaway database

The pipeline SHALL apply all migrations to an ephemeral database so a broken or conflicting migration
fails the build rather than a deployment.

#### Scenario: A broken migration fails the build

- **WHEN** a migration contains invalid SQL
- **THEN** the migration check fails
- **AND** the failure output names the offending migration file

#### Scenario: Migrations are re-runnable

- **WHEN** the migration check runs twice in sequence against the same database
- **THEN** the second run makes no changes and succeeds

### Requirement: Production dependencies are audited, development tooling is not gated

The pipeline SHALL fail on a known vulnerability in runtime dependencies and SHALL NOT fail on
advisories that exist only in development tooling, which are recorded instead.

#### Scenario: Runtime advisory fails the build

- **WHEN** a runtime dependency carries a known high or critical advisory
- **THEN** the audit gate fails
- **AND** the advisory identifier appears in the output

#### Scenario: Dev-only advisory is reported, not fatal

- **WHEN** an advisory exists only in development tooling
- **THEN** the pipeline records it
- **AND** the build continues
