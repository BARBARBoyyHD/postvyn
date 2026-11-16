# asset-intake Specification

## Purpose
TBD - created by archiving change agent-intake. Update Purpose after archive.
## Requirements
### Requirement: Bytes are stored once and identified by content

An upload SHALL be recorded as an R2 object plus a `media` row keyed by content hash, and uploading the
same bytes twice MUST reuse the existing row rather than store a second object.

#### Scenario: The same file twice costs once

- **WHEN** identical bytes are uploaded to the same workspace
- **THEN** the existing media row is returned
- **AND** no second object is written

#### Scenario: The type is decided by content

- **WHEN** a file is uploaded
- **THEN** the MIME type is determined from its magic bytes, not its filename
- **AND** a file whose bytes are not an accepted image or video is refused with the reason

#### Scenario: An oversized file is refused before it is stored

- **WHEN** an upload exceeds the configured ceiling
- **THEN** it is refused with a message naming the limit
- **AND** nothing is written to R2

### Requirement: Uploaded assets are grouped by the post they belong to

A media row SHALL record whether it is publishable and, when created for a draft, which post it serves;
reference material MUST NOT be attachable as publishable content.

#### Scenario: A review artifact is not publishable

- **WHEN** an asset is marked as reference material
- **THEN** it is stored and visible on the post
- **AND** the spec engine excludes it from the media count

#### Scenario: An orphan upload is still usable

- **WHEN** an asset is uploaded before its post exists
- **THEN** it can be attached later by id
- **AND** it is listed as unattached rather than hidden

### Requirement: Uploads work for both callers, one implementation

The session-authenticated route and the token-authenticated route SHALL share one intake implementation,
so a rule added for the human is not missing for the agent.

#### Scenario: The same rejection for both

- **WHEN** an unsupported file is uploaded by a signed-in operator and by an agent
- **THEN** both are refused with the same code and message

