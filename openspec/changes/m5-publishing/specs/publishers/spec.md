## ADDED Requirements

### Requirement: Every adapter can describe what it would do, without doing it

A publish SHALL be previewable: the exact calls, the resolved media URLs, the caption and the estimated
cost, with no network request made. Publishing for real MUST require an explicit confirmation naming the
platform and the account.

#### Scenario: A dry run touches nothing

- **WHEN** a publish is requested as a dry run
- **THEN** the response lists the calls that would be made
- **AND** no platform endpoint is contacted

#### Scenario: A real publish is deliberate

- **WHEN** a publish is requested for real
- **THEN** the request must name the platform and account it is going to
- **AND** a mismatch with the variant's channel is refused

### Requirement: A post is published only when it is verified

Publishing SHALL read the post back from the platform, store the platform's own post id and URL, and set
the variant to `published` only after that read succeeds.

#### Scenario: Success requires a read-back

- **WHEN** a publish call returns success
- **THEN** the post is fetched from the platform before the variant is marked `published`
- **AND** the stored URL is the platform's, not one this app constructed

#### Scenario: An unverified success is not a publish

- **WHEN** the publish call succeeds but the read-back fails
- **THEN** the result is recorded as uncertain
- **AND** the operator is asked to look, not told it worked

#### Scenario: Verification can be repeated later

- **WHEN** the operator asks to verify an existing post
- **THEN** the platform is read again
- **AND** the recorded result is corrected if the platform disagrees

### Requirement: Platform mechanics are the adapter's business

Each adapter SHALL own its own flow — Instagram's container-then-publish, Threads' two-step, X's chunked
media upload — and MUST surface a platform error in the platform's own words.

#### Scenario: A container that is not ready parks the job

- **WHEN** Instagram has not finished processing a container
- **THEN** the job parks as awaiting the platform
- **AND** it is not treated as a failure or retried from scratch

#### Scenario: A platform refusal is quoted, not paraphrased

- **WHEN** a platform rejects a publish
- **THEN** the stored error contains the platform's code and message
- **AND** the operator sees that, not a generic failure

### Requirement: X's cost is disclosed before it is incurred

A publish to X SHALL show an estimated cost before the first send and SHALL record the estimate with the
result. A link in the post changes the price, and the operator MUST be told.

#### Scenario: The estimate appears before the first post

- **WHEN** an X publish is previewed for an account that has never posted
- **THEN** the estimated cost is shown
- **AND** the confirmation makes clear it is a paid call

#### Scenario: The estimate follows the post's shape

- **WHEN** the post contains a URL
- **THEN** the estimate reflects the higher cost for a post with a link
- **AND** the recorded result keeps the estimate that was used
