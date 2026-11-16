## ADDED Requirements

### Requirement: Credentials are entered in the app and encrypted at rest

Platform credentials SHALL be submitted through the app, stored encrypted in `channel_credentials`, and
MUST NOT appear in environment variables, the repository, logs or API responses.

#### Scenario: A token is never returned

- **WHEN** any endpoint reads a channel
- **THEN** the response carries the channel's label and status
- **AND** no ciphertext or plaintext token appears in it

#### Scenario: Ciphertext is bound to its channel

- **WHEN** a stored row is copied to another channel id
- **THEN** decryption fails
- **AND** the failure is treated as a re-authorisation need, not a crash

#### Scenario: Rotation is a recorded pass, not a replace

- **WHEN** the encryption key is rotated
- **THEN** rows are re-encrypted with an incremented `key_version`
- **AND** a row that fails to re-encrypt is reported rather than left silently unreadable

### Requirement: A channel's state reflects what is known about it

A channel SHALL be `active` only when its credentials work, `reauth_required` when they do not, and
`disabled` when the operator turned it off deliberately.

#### Scenario: An expired token flips the channel

- **WHEN** a platform rejects a token as expired or revoked
- **THEN** the channel becomes `reauth_required`
- **AND** the board shows which channels need attention

#### Scenario: An imported, unconnected channel is not active

- **WHEN** a channel came from the vault import with no credentials
- **THEN** it stays `reauth_required` until connected
- **AND** no publish is attempted against it

### Requirement: Tokens refresh themselves where the platform allows

Long-lived tokens SHALL be refreshed on a schedule before they expire, and a refresh failure MUST be
visible rather than silent.

#### Scenario: The monthly refresh keeps Instagram alive

- **WHEN** the refresh job runs before expiry
- **THEN** the stored token is replaced and its expiry extended
- **AND** the channel stays `active`

#### Scenario: A refresh that fails asks for a human

- **WHEN** a refresh is refused
- **THEN** the channel moves to `reauth_required`
- **AND** the operator is told which account and what to do
