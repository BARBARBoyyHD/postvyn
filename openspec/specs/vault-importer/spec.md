# vault-importer Specification

## Purpose
TBD - created by archiving change m2-vault-import-and-board. Update Purpose after archive.
## Requirements
### Requirement: A vault folder becomes a post with its variants

The importer SHALL read each `queue/<item>` folder and write one post plus one variant per platform
entry, preserving status, schedule and any existing publish record exactly as recorded.

#### Scenario: A folder imports as one post

- **WHEN** the importer reads `brands/zavron/social/instagram/queue/2026-11-zavron-stock-csv/`
- **THEN** one post exists with that folder's `item.json` title, status and format
- **AND** one variant exists for the Instagram channel with its caption and ordered media

#### Scenario: Status is imported, not recomputed

- **WHEN** a folder records status `review`
- **THEN** the post is written as `review`
- **AND** the importer does not advance, normalise or "fix" it

#### Scenario: Nothing is dropped silently

- **WHEN** the importer meets a field it does not recognise in `item.json`
- **THEN** it reports the field in the diff output
- **AND** it does not discard the folder without saying so

### Requirement: Import is a dry run unless asked to commit

The importer SHALL do nothing destructive by default: it reports what would be written and exits. A
commit requires an explicit flag.

#### Scenario: The default run changes nothing

- **WHEN** the importer runs without the commit flag
- **THEN** the database is byte-identical afterwards
- **AND** the report lists folders seen and rows that would be written

#### Scenario: A mismatch stops the commit

- **WHEN** the diff reports a field mismatch between the vault and what would be written
- **THEN** the commit is refused
- **AND** the mismatching fields are named

### Requirement: Re-running the importer is safe

The importer SHALL be idempotent on `(brand, platform, item id)`: a second run updates the existing
rows and creates no duplicates.

#### Scenario: The second run writes no new rows

- **WHEN** the importer runs twice with commit
- **THEN** the second run reports zero inserts
- **AND** the post and variant counts are unchanged

#### Scenario: An edited caption is updated, not duplicated

- **WHEN** a caption changes in the vault and the importer is re-run
- **THEN** the existing variant's caption is updated
- **AND** no second variant appears for that post and channel

#### Scenario: Two folders claim the same identity

- **WHEN** two folders resolve to the same `(brand, platform, item id)`
- **THEN** the first is imported
- **AND** the second is reported as a conflict rather than merged or silently skipped

### Requirement: Review artifacts are imported as non-postable

Assets whose names mark them as working files (`contact-sheet*`, `thumb*`, `preview*`) SHALL be
recorded with `postable = false`, so they can be displayed but never published.

#### Scenario: A contact sheet cannot become a carousel slide

- **WHEN** a folder contains `contact-sheet.png` and three real slides
- **THEN** the contact sheet is stored with `postable = false`
- **AND** the variant's media order contains only the three slides

### Requirement: Paths that are awkward on this machine still import

The importer SHALL accept vault paths containing spaces, apostrophes and mixed separators, because the
operator's content directory is named `Uwi's-Department`.

#### Scenario: A quoted path with an apostrophe is not mangled

- **WHEN** the importer is pointed at a directory whose path contains an apostrophe
- **THEN** every folder is read correctly
- **AND** no file is skipped because of quoting

