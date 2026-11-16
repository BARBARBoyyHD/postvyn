## ADDED Requirements

### Requirement: A post shows what would ship

The post view SHALL show the caption, hashtags, media in publish order, schedule, spec state and the
platform it targets, read through the workspace-scoped repository.

#### Scenario: The caption and hashtags are shown as stored

- **WHEN** the operator opens an imported post
- **THEN** the caption renders with its original line breaks
- **AND** hashtags appear as they were recorded, not re-derived

#### Scenario: Media order is the publish order

- **WHEN** a variant has four media items in a recorded order
- **THEN** the view lists them in that order
- **AND** items flagged non-postable are marked as excluded rather than hidden without explanation

### Requirement: The spec verdict is visible, even before the engine exists

Each variant SHALL display its `spec_state` and the spec version it was checked against. In M2 every
imported variant is `unchecked`, and the view SHALL say so rather than implying it passed.

#### Scenario: An unchecked variant is not presented as valid

- **WHEN** a variant has `spec_state = 'unchecked'`
- **THEN** the view states that it has not been checked against the platform spec
- **AND** no pass/fail colour is applied

### Requirement: History is the audit trail, not a reconstruction

The post view SHALL show `activity_log` entries for that post in reverse chronological order, and
SHALL NOT invent entries for events that were never recorded.

#### Scenario: An imported post with no history says so

- **WHEN** a post was imported with no prior activity
- **THEN** the history area reports that there is nothing recorded
- **AND** it does not fabricate an "imported" event unless the importer actually wrote one

#### Scenario: Recorded events appear newest first

- **WHEN** a post has three recorded events
- **THEN** all three appear, newest first
- **AND** each shows actor, action and time

### Requirement: A post from another workspace is not viewable

Fetching a post by id SHALL be scoped to the context's workspace, and a post belonging elsewhere SHALL
be indistinguishable from one that does not exist.

#### Scenario: A foreign id returns not found

- **WHEN** a post id from another workspace is requested
- **THEN** the response is `404`
- **AND** the body contains no title, caption or other trace of that post
