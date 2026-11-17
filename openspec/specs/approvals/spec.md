# approvals Specification

## Purpose
TBD - created by archiving change m4-approval-and-jobs. Update Purpose after archive.
## Requirements
### Requirement: Approval binds to the content, not the row

An approval SHALL record the hash of the variant's caption, hashtags and media order, the user and the
time. Publishing MUST recompute the hash and refuse when it no longer matches.

#### Scenario: Editing after approval voids it

- **WHEN** a variant is approved and then its caption changes
- **THEN** the post returns to `review`
- **AND** a publish attempt answers `409 reapproval_required` rather than publishing

#### Scenario: Media reordering voids it too

- **WHEN** the operator reorders a carousel after approval
- **THEN** the hash no longer matches
- **AND** the approval stops counting, because a different carousel was never approved

#### Scenario: An unchanged variant publishes on its original approval

- **WHEN** nothing has changed since the approval
- **THEN** the recomputed hash matches
- **AND** publishing proceeds without asking again

### Requirement: An approval carries its slot

Approving SHALL take a slot time and store it, and the publish job's earliest run time MUST be derived
from that slot rather than from the moment of approval.

#### Scenario: A future slot does not publish immediately

- **WHEN** a variant is approved for tomorrow at 09:00
- **THEN** no job runs before that time
- **AND** the job remains queued and visible as scheduled

#### Scenario: The slot is displayed in the workspace timezone

- **WHEN** a slot is shown to the operator
- **THEN** it is rendered in the workspace's timezone
- **AND** the stored value remains unix milliseconds in UTC

### Requirement: Bulk approval is auditable per item

Approving several variants at once SHALL write one audit entry per variant, with the actor and the
approval it created.

#### Scenario: Twelve approvals leave twelve traces

- **WHEN** twelve variants are approved in one action
- **THEN** twelve `approvals` rows exist
- **AND** twelve `activity_log` rows name the actor and each variant

#### Scenario: One refusal does not silently cancel the rest

- **WHEN** one item in a batch cannot be approved
- **THEN** the response names which item failed and why
- **AND** the successful approvals are not rolled back without saying so

### Requirement: Only owners approve, and the API says so

Approval SHALL be refused for `editor` and `viewer` with `403`, and the refusal MUST NOT reveal whether
the variant exists in another workspace.

#### Scenario: An editor is refused

- **WHEN** an `editor` calls the approve endpoint
- **THEN** the response is `403`
- **AND** no approval row is written

#### Scenario: A foreign variant is not found

- **WHEN** the variant belongs to another workspace
- **THEN** the response is `404`
- **AND** the body carries no caption or title from that variant

