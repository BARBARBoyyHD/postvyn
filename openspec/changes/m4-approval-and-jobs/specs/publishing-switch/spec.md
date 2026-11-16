## ADDED Requirements

### Requirement: Publishing can be stopped in one move, and resumed without loss

A per-workspace switch and a global switch SHALL both be checked at claim time. Turning either off MUST
stop new work immediately, MUST NOT discard queued work, and MUST leave a clear record of who flipped it.

#### Scenario: Flipping the switch stops the next tick

- **WHEN** the workspace switch is off
- **THEN** the next tick claims nothing for that workspace
- **AND** no platform call is made

#### Scenario: Queued work survives the pause

- **WHEN** publishing is turned off and later back on
- **THEN** the jobs that were queued are still queued
- **AND** they resume without being recreated or reapproved

#### Scenario: The global switch cannot be overridden by a workspace

- **WHEN** the global switch is off and a workspace switch is on
- **THEN** nothing publishes
- **AND** the reason states that publishing is disabled globally

#### Scenario: The switch change is auditable

- **WHEN** either switch changes
- **THEN** `activity_log` records who changed it and to what value
- **AND** the health surface reflects the current state
