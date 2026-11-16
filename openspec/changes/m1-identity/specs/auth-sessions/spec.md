## ADDED Requirements

### Requirement: Signup creates an unverified account

An account SHALL be created by email and password, and MUST NOT be able to sign in until its email
address is verified by a single-use link.

#### Scenario: Signup sends a verification email

- **WHEN** a visitor submits an unused email address and a password meeting the minimum length
- **THEN** the account exists in `user` with `emailVerified` false
- **AND** a verification email is handed to Resend
- **AND** signing in with those credentials is refused until the link is opened

#### Scenario: The verification link is single-use

- **WHEN** a verification link is opened twice
- **THEN** the first open marks the address verified
- **AND** the second open fails without changing state

#### Scenario: A duplicate signup does not reveal the existing account

- **WHEN** a visitor submits an email address that already has an account
- **THEN** the response looks identical to a successful signup
- **AND** the existing account is not modified

### Requirement: Sessions are long-lived and revocable

A signed-in session SHALL survive a browser restart, expire after roughly thirty days of inactivity,
and be revocable across every device at once.

#### Scenario: Restarting the browser keeps the operator signed in

- **WHEN** an operator signs in, closes the browser, and reopens the application
- **THEN** they are still signed in
- **AND** no credentials are re-entered

#### Scenario: Revoke-all ends every session

- **WHEN** an operator chooses "sign out of every device"
- **THEN** every session row for that user is invalidated
- **AND** a request holding any of those cookies is treated as anonymous immediately

#### Scenario: Session cookies are not readable by scripts

- **WHEN** a session cookie is set
- **THEN** it is `httpOnly`, `secure` in production, and `sameSite` lax or stricter

### Requirement: Password reset works without enumerating accounts

Reset SHALL be started by email, use a single-use link with a short time-to-live, and respond
identically whether or not the address has an account.

#### Scenario: Unknown address gets the same answer as a known one

- **WHEN** reset is requested for an address with no account
- **THEN** the response is byte-identical to the one for an existing account
- **AND** no email is sent

#### Scenario: The reset link expires

- **WHEN** a reset link is used after its time-to-live
- **THEN** the request is refused with a generic message
- **AND** the password is unchanged

#### Scenario: A completed reset invalidates older sessions

- **WHEN** a password is reset successfully
- **THEN** prior sessions for that user stop being valid

### Requirement: The endpoints that send mail are rate-limited and bot-checked

Signup and reset SHALL require a valid Turnstile token and SHALL be rate-limited per address and per
IP, because both send email to an address the caller chooses.

#### Scenario: A missing or invalid Turnstile token is refused before mail is sent

- **WHEN** signup or reset is called without a valid Turnstile token
- **THEN** the request is rejected
- **AND** no email is dispatched

#### Scenario: Repeated attempts are throttled

- **WHEN** reset is requested more than the allowed number of times in the window for the same address
- **THEN** further requests are refused with `429`
- **AND** the response still does not reveal whether the account exists

### Requirement: Authentication events are auditable

Sign-in, failed sign-in, password reset and revoke-all SHALL be recorded in `activity_log` with the
actor and the outcome.

#### Scenario: A failed sign-in is recorded

- **WHEN** a sign-in attempt uses the wrong password
- **THEN** an `activity_log` row is written with the attempted identifier and a failure outcome
- **AND** the row cannot be updated or deleted, because the table is append-only
