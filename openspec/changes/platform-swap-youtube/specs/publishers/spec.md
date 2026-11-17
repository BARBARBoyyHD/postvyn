## ADDED Requirements

### Requirement: A YouTube upload is resumable, and only a verified read-back publishes it

A publish to YouTube SHALL initiate a resumable upload, stream the video in chunks from the media's
public URL, and read the video back with `videos.list` before the variant becomes `published`. An
interrupted upload MUST resume from the byte offset it reached under the same upload session; a
second session for the same upload MUST NOT be created while the first can still be resumed.

#### Scenario: An interrupted upload resumes where it stopped

- **WHEN** a chunked PUT fails or the Worker dies after N bytes of a resumable upload
- **THEN** the job parks as awaiting the platform carrying the upload session URL and the byte offset
- **AND** the next tick resumes the PUT from that offset without initiating a second session

#### Scenario: Processing is not published

- **WHEN** the upload returns a video id but `videos.list` still reports the video as processing
- **THEN** the job parks and polls on the tick cadence, within a bounded poll budget
- **AND** the variant is not `published` until the read-back reports the video processed

#### Scenario: A poll budget that runs out asks a human

- **WHEN** the video is still processing after the bounded poll budget
- **THEN** the result is recorded as uncertain
- **AND** the operator is asked to look, not told it worked

#### Scenario: A rejected video is terminal and quotes YouTube

- **WHEN** YouTube rejects the upload or the read-back reports `uploadStatus: rejected`
- **THEN** the stored error carries YouTube's rejection reason verbatim
- **AND** the job dead-letters immediately — a re-initiate would spend another upload slot for a
  deterministic answer

#### Scenario: The stored URL comes from the read-back, never from what we sent

- **WHEN** the read-back returns the video id
- **THEN** the stored URL is built from that id alone
- **AND** a read-back that disagrees with the uploaded metadata records `uncertain`, never `published`

### Requirement: YouTube's upload quota is disclosed before it is spent

Every YouTube preview SHALL state the quota cost of the publish — how many of the project's daily
upload slots it consumes, what the read-back costs, and when the budget resets — before any request
is made, and the estimate SHALL be recorded with the result. Quota constants SHALL be named,
carry their source and read date, and yield to the project's Google Cloud Console quota page when the
two disagree.

#### Scenario: The preview shows the quota cost before the first byte moves

- **WHEN** a YouTube publish is previewed
- **THEN** the response states this publish's upload-slot and read-unit cost against the project's
  daily allocation and the reset time
- **AND** no upload session has been initiated

#### Scenario: The estimate follows the post to the record

- **WHEN** a YouTube publish completes or fails
- **THEN** the quota estimate shown in the preview is stored with the result
- **AND** the operator can see it beside the outcome

#### Scenario: An exhausted quota is quoted and not retried

- **WHEN** YouTube answers `403 quotaExceeded`
- **THEN** the stored error carries YouTube's own code and message
- **AND** the job dead-letters immediately with a quota audit row — every retry would spend another
  slot, and tomorrow's quota cannot be created today

## REMOVED Requirements

### Requirement: X's cost is disclosed before it is incurred

**Reason**: X left the platform lineup on 2026-11-17 (product decision): the pay-per-use adapter,
OAuth 1.0a signing, per-post cost model, credits switch and connect form are all removed from the
product. The requirement can never be satisfied by shipped code again.

**Migration**: the disclosure principle carries over to YouTube's quota in "YouTube's upload quota is
disclosed before it is spent"; `publish_results.estimated_cost_usd` remains as the generic estimate
column so past X results still render; the 402/`cost_blocked` path leaves with X (design decision 7).

## MODIFIED Requirements

### Requirement: Platform mechanics are the adapter's business

Each adapter SHALL own its own flow — Instagram's container-then-publish, Threads' two-step,
YouTube's resumable chunked upload — and MUST surface a platform error in the platform's own words.

#### Scenario: A container that is not ready parks the job

- **WHEN** Instagram has not finished processing a container
- **THEN** the job parks as awaiting the platform
- **AND** it is not treated as a failure or retried from scratch

#### Scenario: A resumable upload that stalls parks the job

- **WHEN** a chunked PUT against YouTube's upload session fails mid-transfer
- **THEN** the job parks carrying the session URL and the byte offset
- **AND** it is not treated as a terminal failure and not restarted from byte zero

#### Scenario: A platform refusal is quoted, not paraphrased

- **WHEN** a platform rejects a publish
- **THEN** the stored error contains the platform's code and message
- **AND** the operator sees that, not a generic failure
