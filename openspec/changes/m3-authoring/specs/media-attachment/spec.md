## ADDED Requirements

### Requirement: Media is attached from the library in an explicit order

Attaching media SHALL reference existing `media` rows, preserve the chosen order, and never treat
non-postable media as publishable. Upload arrives in M6; this decides what goes out and in what order.

#### Scenario: A carousel keeps its order

- **WHEN** the operator attaches four images and orders them
- **THEN** the variant records that order
- **AND** the publish path will replay it exactly

#### Scenario: A review artifact cannot be attached as publishable

- **WHEN** the operator selects a file flagged `postable = false`
- **THEN** it is shown as reference-only
- **AND** it cannot enter the variant's publishable list

### Requirement: Platform size and dimension limits warn before publishing

Attaching media SHALL surface the platform's own constraints — aspect ratio, file size, count — as
warnings on the variant, because a carousel that exceeds the platform's limit fails at publish time,
not at compose time.

#### Scenario: An out-of-range aspect ratio is flagged

- **WHEN** a 1080×1350 image is attached to a platform that only accepts square or landscape
- **THEN** the variant carries a warning naming the constraint
- **AND** the operator can fix it before approval

#### Scenario: Too many items is a hard error

- **WHEN** more items are attached than the platform accepts
- **THEN** the variant is `blocked` rather than warned
- **AND** the reason names the maximum
