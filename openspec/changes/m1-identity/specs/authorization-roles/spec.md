## ADDED Requirements

### Requirement: Roles are enforced where the write happens

Every mutating endpoint SHALL check the caller's role against the action, and refuse with `403` when
the role is insufficient. Hiding a button in the UI is a courtesy, not a control.

#### Scenario: An editor cannot publish

- **WHEN** a request with an `editor` context hits a publish endpoint
- **THEN** it is refused with `403`
- **AND** no job is enqueued and no platform call is attempted

#### Scenario: An editor cannot approve

- **WHEN** a request with an `editor` context hits the approval endpoint
- **THEN** it is refused with `403`
- **AND** no `approvals` row is written

#### Scenario: A viewer cannot write anything

- **WHEN** a request with a `viewer` context attempts any create, update or delete
- **THEN** it is refused with `403`
- **AND** reads continue to succeed

#### Scenario: The owner can do what the role matrix allows

- **WHEN** a request with an `owner` context performs an allowed action
- **THEN** it proceeds
- **AND** the action is recorded in `activity_log`

### Requirement: The role matrix is defined once

The permission for each action SHALL come from a single table in code, so a new endpoint cannot invent
its own rule and drift from the others.

#### Scenario: Every mutating route names an action

- **WHEN** a mutating route handler is added
- **THEN** it declares the action it performs
- **AND** the guard looks the minimum role up in the shared matrix rather than comparing roles inline

#### Scenario: An unknown action fails closed

- **WHEN** a route names an action that is not in the matrix
- **THEN** the guard refuses the request instead of defaulting to allow

### Requirement: Refusals do not leak existence

A `403` SHALL NOT tell the caller whether the target row exists in another workspace; the answer for
"not yours" and "not there" SHALL be the same shape.

#### Scenario: Cross-workspace write looks like a missing row

- **WHEN** a caller with a valid session targets a post id from another workspace
- **THEN** the response is `404`, not `403`
- **AND** the body does not distinguish the two cases
