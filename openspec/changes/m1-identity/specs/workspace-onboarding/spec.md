## ADDED Requirements

### Requirement: The first signup provisions exactly one workspace

Creating an account SHALL create exactly one workspace and exactly one `owner` membership for it, in
a single atomic unit. A user SHALL NOT end up with an account and no workspace, or a workspace they
cannot enter.

#### Scenario: A new account can act immediately after verification

- **WHEN** a new account completes verification
- **THEN** it belongs to exactly one workspace with role `owner`
- **AND** the first request after verification resolves that workspace without asking the user to
  create one

#### Scenario: The workspace and its membership are written atomically

- **WHEN** the provisioning write runs
- **THEN** the workspace row and the membership row are written in one batch
- **AND** if either half fails, neither row exists — a workspace without an owner is unreachable, and
  an owner without a workspace is the same failure wearing a different hat

#### Scenario: Provisioning runs once

- **WHEN** the same account is signed in again, or verification is replayed
- **THEN** no second workspace is created
- **AND** the existing membership is unchanged

### Requirement: Requests resolve their workspace from the session

Every authenticated request SHALL resolve the active workspace from the session (or the user's single
membership), never from a request parameter, and hand the rest of the stack a `WorkspaceContext`.

#### Scenario: A workspace id in the request does not change scope

- **WHEN** a request carries a workspace id in a body or query string that differs from the session's
- **THEN** the session's workspace is used
- **AND** the supplied value has no effect on the rows returned

#### Scenario: An unauthenticated request is rejected before any query

- **WHEN** a request reaches a scoped endpoint without a valid session
- **THEN** it is refused with `401`
- **AND** no repository call is made

### Requirement: Timezone is display configuration, not storage

The workspace SHALL carry a timezone used only for composing and displaying slots. Stored timestamps
remain unix milliseconds in UTC.

#### Scenario: Changing the timezone does not move stored data

- **WHEN** the workspace timezone is changed
- **THEN** no `schedule_at` value is rewritten
- **AND** only rendered times shift
