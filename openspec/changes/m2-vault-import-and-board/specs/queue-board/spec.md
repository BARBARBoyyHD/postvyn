## ADDED Requirements

### Requirement: The board shows a brand's posts by status

The board SHALL present a brand's posts grouped by status, with a count per column, scoped to the
active workspace and brand.

#### Scenario: Columns match the status machine

- **WHEN** the board loads for a brand with posts in `idea`, `review` and `approved`
- **THEN** each of those columns shows its posts and its count
- **AND** empty statuses show a zero, not a missing column

#### Scenario: Another brand's posts stay out

- **WHEN** the board is open for brand A while brand B has posts in the same workspace
- **THEN** only brand A's posts appear
- **AND** the counts agree with the visible cards

### Requirement: One view costs a bounded number of queries

The board SHALL fetch its data in a bounded number of queries regardless of how many posts it shows.
Listing cards MUST NOT issue a query per card.

#### Scenario: A full page of cards issues one batched read

- **WHEN** the board renders a page of twenty posts
- **THEN** the repository executes a constant number of queries
- **AND** that number does not grow with the page size

#### Scenario: The board stays within the free-plan budget

- **WHEN** a board request is measured against D1's per-invocation query allowance
- **THEN** it uses a small single-digit share of it
- **AND** a test asserts the query count rather than relying on review

### Requirement: Filters compose and pagination is stable

Filtering by platform and by pillar SHALL compose, the counts SHALL reflect the active filters, and
pagination SHALL be stable under inserts.

#### Scenario: Two filters narrow the result

- **WHEN** the operator filters to platform `instagram` and pillar `data`
- **THEN** only posts matching both appear
- **AND** the column counts reflect that intersection

#### Scenario: Paging does not repeat or skip a card

- **WHEN** the operator pages through a filtered board while a new post is created
- **THEN** no card appears twice
- **AND** no card is skipped because the underlying order shifted

### Requirement: The board is read-only in this milestone

The board SHALL NOT offer any mutation. Editing, approval and publishing arrive in later milestones,
and a disabled control that pretends otherwise is worse than no control.

#### Scenario: No mutating route is reachable from the board

- **WHEN** the board's routes are inspected
- **THEN** every route is a safe method
- **AND** no button in the board issues a write
