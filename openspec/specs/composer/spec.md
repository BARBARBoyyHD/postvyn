# composer Specification

## Purpose
TBD - created by archiving change m3-authoring. Update Purpose after archive.
## Requirements
### Requirement: A post is created with its intent, not its content

Creating a post SHALL record title, format and pillar, and SHALL start it in `drafting` — never in a
later state. Content is added per variant afterwards, because one post may go to four platforms.

#### Scenario: A new post starts as a draft

- **WHEN** an operator creates a post with a title and format
- **THEN** the post exists in `drafting`
- **AND** `activity_log` records who created it and when

#### Scenario: A post belongs to one brand and cannot drift

- **WHEN** a post is created
- **THEN** it is bound to the active brand from the context
- **AND** no request field can move it to another brand or workspace

### Requirement: Variants are independent per channel

Each target channel SHALL have its own variant with its own caption, hashtags and media order. Editing
one variant MUST NOT alter another.

#### Scenario: Two platforms, two captions

- **WHEN** a post targets Instagram and Threads
- **THEN** each has its own caption and its own media order
- **AND** editing the Instagram caption leaves the Threads caption untouched

#### Scenario: Media order is per variant

- **WHEN** the operator reorders a carousel for one variant
- **THEN** only that variant's order changes
- **AND** the other variants keep theirs

#### Scenario: A variant duplicates as a starting point

- **WHEN** the operator copies a variant to another channel
- **THEN** caption, hashtags and media come across
- **AND** subsequent edits are independent, with no link back

### Requirement: Drafts save themselves

Edits SHALL be persisted without an explicit save, debounced at roughly five seconds, and a refresh or
a closed laptop MUST NOT lose accepted work.

#### Scenario: Typing then closing the tab keeps the text

- **WHEN** the operator types a caption and closes the tab after the debounce
- **THEN** the caption is what they typed when they return
- **AND** no "save" click was required

#### Scenario: A slow save does not overwrite newer text

- **WHEN** a save is in flight and the operator keeps typing
- **THEN** the later text wins
- **AND** the editor never reverts to the older server copy mid-edit

#### Scenario: Autosave is recorded

- **WHEN** a draft is saved automatically
- **THEN** the post's `updated_at` moves
- **AND** the audit trail does not fill up with one row per keystroke

