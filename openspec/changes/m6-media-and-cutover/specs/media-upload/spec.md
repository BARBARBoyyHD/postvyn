## ADDED Requirements

### Requirement: Uploads go straight to storage, not through the Worker

The app SHALL mint a short-lived signed upload URL and record the object afterwards. Image bytes MUST NOT
be proxied through the Worker, because a Worker's CPU budget is measured in milliseconds.

#### Scenario: The browser uploads directly

- **WHEN** an operator uploads a file
- **THEN** the app returns a signed URL scoped to that key and content type
- **AND** the upload completes without the file passing through the Worker

#### Scenario: A signed URL is short-lived and single-purpose

- **WHEN** a signed URL is issued
- **THEN** it expires quickly and covers one key
- **AND** it cannot be reused to write elsewhere in the bucket

#### Scenario: Recording is what makes the file real

- **WHEN** an upload finishes
- **THEN** a `media` row is written with hash, key, size, MIME and dimensions
- **AND** an object with no row is invisible to the app

### Requirement: The file type is decided by content, not by name

The app SHALL determine MIME from the file's magic bytes and SHALL refuse anything that is not an
accepted image or video format. SVG MUST be refused outright.

#### Scenario: A renamed executable is not an image

- **WHEN** a file named `photo.png` is not actually a PNG
- **THEN** it is refused
- **AND** the reason names what it actually appears to be

#### Scenario: SVG never reaches storage

- **WHEN** an SVG is uploaded
- **THEN** it is refused before the object is written
- **AND** the refusal explains that SVG can carry script and no platform accepts it

### Requirement: Metadata is stripped before the object becomes public

Images SHALL be stripped of EXIF metadata — GPS above all — before they are retrievable by URL, and the
stored file MUST be re-validated server-side rather than trusted from the client.

#### Scenario: A phone photo carries no location

- **WHEN** an image with GPS EXIF is uploaded
- **THEN** the stored object contains no GPS data
- **AND** the URL serves the stripped file

#### Scenario: The client's claim is not the record

- **WHEN** the client reports the MIME and dimensions it believes the file has
- **THEN** the server verifies both before recording them
- **AND** a disagreement is refused, not averaged

### Requirement: The same file is stored once

Deduplication SHALL be by content hash within a workspace, so re-uploading a file returns the existing
object and URL rather than a second copy.

#### Scenario: A second upload of the same bytes is free

- **WHEN** an identical file is uploaded again to the same workspace
- **THEN** the existing media row is returned
- **AND** no second object is written

#### Scenario: Two workspaces do not share an object

- **WHEN** the same bytes are uploaded to a different workspace
- **THEN** each workspace has its own row
- **AND** deleting one does not break the other's references

### Requirement: Public URLs are stable and controlled

Media SHALL be served from a configured public base URL, and the app MUST refuse to publish media whose
public URL cannot be resolved.

#### Scenario: Publishing without a public base is refused early

- **WHEN** `R2_PUBLIC_BASE` is not configured
- **THEN** a publish that needs media fails with a configuration message
- **AND** it does not attempt the platform call

#### Scenario: The URL a platform fetches is the one stored

- **WHEN** a variant's media is resolved for publishing
- **THEN** the URL is derived from the stored key and the configured base
- **AND** the same URL is available to verify after the fact
