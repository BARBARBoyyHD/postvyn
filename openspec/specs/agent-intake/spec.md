# agent-intake Specification

## Purpose
TBD - created by archiving change agent-intake. Update Purpose after archive.
## Requirements
### Requirement: A token is scoped, hashed and revocable

An agent token SHALL be bound to one workspace and one brand, stored only as a hash, shown once at
minting, and revocable without changing anything else.

#### Scenario: The token is not retrievable

- **WHEN** any endpoint or CLI lists tokens
- **THEN** it shows the label, the scope and the last use
- **AND** never the token or its hash

#### Scenario: A revoked token stops working immediately

- **WHEN** a token is revoked and then used
- **THEN** the request is refused with `401`
- **AND** nothing is created

#### Scenario: A token from another workspace cannot reach this one

- **WHEN** a valid token presents a brand id belonging to a different workspace
- **THEN** the request is refused
- **AND** no row is written

### Requirement: A token can create drafts, and cannot approve them

The agent surface SHALL permit creating drafts and uploading assets. It MUST NOT be able to approve,
schedule or publish, and no request shape accepted by it may reach those actions.

#### Scenario: Approval is not in the token's reach

- **WHEN** an agent calls any approval or publish endpoint with its token
- **THEN** the response is `403`
- **AND** the post remains in `review`

#### Scenario: What a token did is attributable

- **WHEN** a draft is created by an agent
- **THEN** `activity_log` records the token's label as the actor
- **AND** the post detail shows it was ingested rather than typed

### Requirement: One call delivers a complete draft

A single request SHALL create the post, its per-channel variants, and attach the assets — with the
caption and hashtags supplied by the caller — and SHALL return the post id together with each variant's
verdict.

#### Scenario: A video arrives with its caption

- **WHEN** an agent posts a video, a caption and hashtags for one channel
- **THEN** one post exists in `review`
- **AND** its variant carries that caption and those hashtags
- **AND** the asset is attached in the submitted order

#### Scenario: A caption the platform would refuse is refused here

- **WHEN** the supplied caption exceeds the platform's ceiling
- **THEN** the response reports the verdict as blocked, naming the field and the counts
- **AND** the post is still created so the human can fix it, with the block visible on the card

#### Scenario: Partial failure is not silent success

- **WHEN** one target channel fails validation of its channel id
- **THEN** the response lists which target failed and why
- **AND** the successful targets are reported as created

