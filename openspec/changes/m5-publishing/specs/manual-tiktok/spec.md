## ADDED Requirements

### Requirement: TikTok ships as a pack, not an upload

A TikTok target SHALL produce an upload pack — caption, hashtags, ordered assets, and a checklist — and
MUST NOT attempt an automated upload. Recording completion SHALL be a manual action by the operator.

#### Scenario: A pack is generated with everything needed

- **WHEN** a TikTok variant reaches its slot
- **THEN** a pack is produced containing the caption, hashtags, asset list with local paths and the
  checklist
- **AND** no network request is made to TikTok

#### Scenario: Completion is recorded by a human

- **WHEN** the operator has posted it by hand
- **THEN** they mark it complete with the post URL
- **AND** the variant becomes `published` with that URL

#### Scenario: An unrecorded pack is not success

- **WHEN** a pack exists but nobody marked it done
- **THEN** the post is shown as waiting on a manual step
- **AND** it is not counted as published

### Requirement: The reason is documented where the operator will meet it

The pack and the UI SHALL explain why TikTok is manual — their Content Sharing Guidelines name utility
uploads to managed accounts as unacceptable — so the limitation is understood rather than worked around.

#### Scenario: The explanation is present, not buried

- **WHEN** a TikTok target is created or viewed
- **THEN** the interface states why this is a manual step
- **AND** the generated pack repeats it in one line
