## ADDED Requirements

### Requirement: Every data access requires a workspace context

Data access SHALL be reachable only through a repository layer whose every function takes a
workspace context argument. The context carries the workspace id, the acting user and their role, and
it is resolved from the session rather than from request input.

#### Scenario: A query cannot be issued without a context

- **WHEN** a caller attempts to read or write workspace data
- **THEN** the repository requires a context argument
- **AND** the underlying database handle is not obtainable by the caller

#### Scenario: Workspace identity comes from the session

- **WHEN** a request supplies a workspace identifier in a body or query parameter that differs from
  the session's active workspace
- **THEN** the repository uses the session's workspace
- **AND** the supplied value has no effect on which rows are returned

### Requirement: The database binding is confined to one module

The D1 binding SHALL be read in exactly one module, `apps/frontend/src/db/client.ts`. No route
handler, server component, server action or script may obtain the binding directly.

#### Scenario: Import outside the database module is rejected

- **WHEN** a module outside `src/db` imports the client module, the binding or a raw query helper
- **THEN** lint fails with an error naming the boundary

### Requirement: Cross-workspace reads are impossible

Given two workspaces each holding data, a context for one workspace MUST NOT be able to read the
other's rows through any repository function, including by passing a known row identifier.

#### Scenario: Listing returns only the active workspace

- **WHEN** workspace A and workspace B each have brands, channels and posts seeded
- **AND** a repository list is called with workspace A's context
- **THEN** only A's rows are returned

#### Scenario: Direct identifier lookup does not cross the boundary

- **WHEN** a repository lookup is called with workspace A's context and a row id that belongs to
  workspace B
- **THEN** the result is treated as not found
- **AND** the response does not reveal that the row exists elsewhere

### Requirement: The tenancy boundary is proven by an automated test

A test SHALL seed two workspaces and assert isolation across the repository surface. This test is the
exit criterion for the foundational change and MUST run against the real Workers runtime with a real
local database, not against mocks.

#### Scenario: Isolation test runs in the deployed runtime

- **WHEN** the isolation test suite runs
- **THEN** it executes in the Workers runtime with a real D1 database
- **AND** a deliberately broken repository (missing workspace filter) makes it fail

### Requirement: Tenancy is recorded as a downgrade, not a guarantee by default

Because the database offers no row-level security, the project SHALL keep a written record that this
boundary is application-enforced and weaker than the original design, together with the compensating
controls.

#### Scenario: Documentation states the trade-off

- **WHEN** the architecture decision record for tenancy is read
- **THEN** it names the missing database-level guarantee
- **AND** it lists the compensating controls (single access path, lint rule, isolation test)
