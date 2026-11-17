## ADDED Requirements

### Requirement: A YouTube channel connects with OAuth2 values the operator obtains outside the app

YouTube credentials SHALL be a Google OAuth client id, client secret and refresh token that the
operator creates in the Google Cloud console and pastes into the app — the same enter-in-the-app path
as the other platforms, encrypted per channel in `channel_credentials`. The app MUST NOT run an
in-app Google redirect or consent flow, and MUST NOT store credentials in environment variables.

#### Scenario: Connecting proves the credentials before the channel is active

- **WHEN** an operator submits YouTube credentials for a channel
- **THEN** the three values are stored encrypted, bound to the channel id
- **AND** the channel becomes `active` only after the refresh token successfully mints an access
  token and resolves the channel's own account reference from the platform

#### Scenario: The account reference comes from the platform, not from typing

- **WHEN** the connect call verifies the credentials
- **THEN** the channel's account reference is read from the authenticated account's own channel
- **AND** a mistyped handle or id cannot produce a channel that looks connected and never publishes

#### Scenario: A refresh token from a Testing-mode consent screen fails visibly

- **WHEN** a stored refresh token dies in Google's 7-day Testing-mode window (or is revoked)
- **THEN** the mint fails with Google's `invalid_grant`
- **AND** the channel moves to `reauth_required` naming re-authorisation, with the connect guidance
  pointing at publishing the consent screen to production

## MODIFIED Requirements

### Requirement: Tokens refresh themselves where the platform allows

Long-lived tokens SHALL be refreshed on a schedule before they expire, and a refresh failure MUST be
visible rather than silent.

#### Scenario: The monthly refresh keeps Instagram alive

- **WHEN** the refresh job runs before expiry
- **THEN** the stored token is replaced and its expiry extended
- **AND** the channel stays `active`

#### Scenario: The monthly pass exercises YouTube's refresh token

- **WHEN** the scheduled pass runs for a YouTube channel
- **THEN** a fresh access token is minted from the stored refresh token and the channel's health is
  re-checked
- **AND** a refusal (`invalid_grant`) flips the channel to `reauth_required` with an audit row — the
  same path an expired Instagram token takes, and the same path that defeats Google's
  unused-token invalidation

#### Scenario: A refresh that fails asks for a human

- **WHEN** a refresh is refused
- **THEN** the channel moves to `reauth_required`
- **AND** the operator is told which account and what to do
