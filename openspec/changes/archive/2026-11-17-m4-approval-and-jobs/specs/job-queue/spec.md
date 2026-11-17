## ADDED Requirements

### Requirement: A job is claimed by exactly one tick

Claiming SHALL be a single statement that selects a queued, due row and transitions it to `claimed` with
a lease, returning the row only to the caller that won it. Two concurrent ticks MUST produce one publish.

#### Scenario: Two ticks, one job, one publish

- **WHEN** two ticks run at the same moment against a single due job
- **THEN** exactly one claims it
- **AND** exactly one publish attempt reaches the platform

#### Scenario: An expired lease is reclaimable

- **WHEN** a claimed job's lease expires without completing
- **THEN** a later tick may claim it again
- **AND** the attempt count increases, so a poison job cannot spin forever

#### Scenario: Nothing due means nothing claimed

- **WHEN** every job is either future-dated or finished
- **THEN** the claim returns no rows
- **AND** the tick exits without side effects

### Requirement: Work that outlives the request parks, it does not fail

A publish that needs the platform to finish processing SHALL move the job to `awaiting_platform` with the
information needed to resume, and a later tick MUST continue it from that exact point.

#### Scenario: A slow container is resumed, not repeated

- **WHEN** the platform has accepted a container but not finished processing it
- **THEN** the job parks as `awaiting_platform` with the container id
- **AND** a later tick continues polling instead of creating a second container

#### Scenario: A parked job is visible as waiting, not stuck

- **WHEN** the operator looks at a parked job
- **THEN** it is described as waiting on the platform
- **AND** it is not counted as a failure

### Requirement: Failures retry with backoff, then stop

A failed attempt SHALL be retried a bounded number of times with increasing delay, and SHALL end in a
terminal state carrying the platform's own error text.

#### Scenario: Three attempts, then parked as failed

- **WHEN** a publish fails repeatedly
- **THEN** it is retried with backoff up to the configured limit
- **AND** it then stops, with the platform's error preserved for the operator

#### Scenario: A retry never double-posts

- **WHEN** an attempt failed but the platform may in fact have accepted it
- **THEN** the result is recorded as uncertain rather than retried blindly
- **AND** the operator is told to check before anything is re-sent

### Requirement: The queue is observable without reading the database

The system SHALL expose what is due, what is claimed and what has failed, so an operator can answer
"what ships in the next 24 hours" from the app.

#### Scenario: Due-soon is a list, not a query

- **WHEN** the operator asks what is due in the next day
- **THEN** they get the posts with slot times in their timezone
- **AND** the count matches what the next ticks will attempt
