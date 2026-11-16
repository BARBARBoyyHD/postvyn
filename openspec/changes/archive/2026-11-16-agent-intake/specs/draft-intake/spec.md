## ADDED Requirements

### Requirement: An ingested draft starts in review

A draft created from outside SHALL be created in `review` with its verdict already computed, and MUST NOT
skip the human gate or arrive at a later state.

#### Scenario: Ingest lands in review

- **WHEN** a draft is ingested successfully
- **THEN** the post's status is `review`
- **AND** the board shows it in the review column immediately

#### Scenario: The verdict travels with the draft

- **WHEN** a draft is ingested
- **THEN** every variant carries `spec_state` and `spec_version`
- **AND** the returned payload includes the issues found, so the caller can fix them without a second
  request

### Requirement: The same payload is accepted from the operator and from an agent

The draft shape SHALL be identical for both callers, so a script that works with a token also describes
what the UI sends.

#### Scenario: One shape, two doors

- **WHEN** the same JSON is posted by a signed-in operator and by an agent
- **THEN** both produce the same post and the same verdicts
- **AND** the only difference is who is recorded as the actor
