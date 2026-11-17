# spec-engine Specification

## Purpose
TBD - created by archiving change m3-authoring. Update Purpose after archive.
## Requirements
### Requirement: Platform rules are versioned data, not code

Each platform's limits SHALL live in a versioned rule set derived from that platform's spec, and every
validation result SHALL record which version produced it. Changing a limit MUST be a reviewable data
change, not an edit inside a component.

#### Scenario: A verdict names the spec version it used

- **WHEN** a variant is validated
- **THEN** `spec_state` and `spec_version` are both written
- **AND** the verdict can be traced to the exact rule set that produced it

#### Scenario: Changing a limit changes behaviour without a code edit

- **WHEN** a platform's caption ceiling changes in the rule data
- **THEN** validation follows the new ceiling on the next check
- **AND** no component needed editing

#### Scenario: An unknown platform is refused, not guessed

- **WHEN** a variant targets a platform with no rule set
- **THEN** validation fails closed with `blocked`
- **AND** the reason names the missing platform

### Requirement: Counting matches the platform's own arithmetic

The caption counter SHALL use each platform's counting rule, including link handling, rather than
counting characters. A counter that disagrees with the platform turns a working post into a rejection.

#### Scenario: A URL counts as its fixed cost on X

- **WHEN** a caption for X contains a URL of any length
- **THEN** the counted length adds the platform's fixed cost for a link
- **AND** the remaining budget reflects that, not the raw character count

#### Scenario: Hashtags count against the budget where the platform puts them

- **WHEN** hashtags are placed in the caption for Threads or X
- **THEN** they are included in the counted length
- **AND** for Instagram, where they belong in the first comment, the caption budget excludes them

#### Scenario: The ceiling is the platform's, not a round number

- **WHEN** a caption is validated for a platform
- **THEN** the ceiling is that platform's documented limit
- **AND** a caption one character over is `blocked`, not warned

### Requirement: Hard errors block, warnings are overridable with a reason

A violation the platform would reject SHALL block the variant. A judgement call SHALL warn, SHALL NOT
block, and SHALL require a typed reason to proceed — recorded in the audit trail with who accepted it.

#### Scenario: A blocking error cannot be overridden

- **WHEN** a caption exceeds the platform's ceiling
- **THEN** the variant stays `blocked` regardless of role
- **AND** no override path exists for it

#### Scenario: A warning is accepted with a recorded reason

- **WHEN** the operator proceeds past a warning
- **THEN** a reason is required
- **AND** an `activity_log` row records the warning, the reason and the actor

#### Scenario: The board shows the verdict before the detail page

- **WHEN** a card is rendered
- **THEN** its spec state is visible on the card
- **AND** a blocked variant is distinguishable from a warned one without opening it

