## ADDED Requirements

### Requirement: Unreferenced working files are purged on a schedule

Non-postable media and objects referenced by nothing SHALL be deleted after a stated retention period, and
the purge MUST NOT touch anything a variant still points at.

#### Scenario: A review artifact is deleted, a referenced file is not

- **WHEN** the purge runs
- **THEN** non-postable media past the retention window is deleted from storage and from `media`
- **AND** any object referenced by a variant is left alone regardless of age

#### Scenario: Deletion is recorded before it happens

- **WHEN** an object is about to be purged
- **THEN** the run logs what it will delete and how much
- **AND** a dry-run mode shows the same list without deleting

#### Scenario: A published post's media is never purged

- **WHEN** a variant has been published
- **THEN** its media is exempt from every cleanup path
- **AND** that exemption is asserted by a test, not by a comment
