## ADDED Requirements

### Requirement: YouTube's metadata limits are checked before the API sees them

Each YouTube variant SHALL be validated against the documented limits of the `videos` resource before
any upload is initiated: a non-empty title of at most 100 characters, a description of at most 5000
**bytes** of UTF-8, hashtags totalling at most 500 characters as one string (commas between items
count; a tag containing spaces counts as if quoted, quotes included), and exactly one video file.
Every number SHALL be a named constant carrying its source and read date, per "Platform rules are
versioned data, not code".

Source for all four limits — YouTube Data API v3 `videos` resource reference
(`developers.google.com/youtube/data/reference/rest/v3/videos`), last updated 2026-11-17, read
2026-11-17: `snippet.title` "maximum length of 100 characters"; `snippet.description` "maximum
length of 5000 bytes" (the API counts bytes — YouTube Help's "5,000 characters" is the loose
retelling; the API is the validator); `snippet.tags[]` "maximum length of 500 characters" with commas
and space-quoting counted.

#### Scenario: A title one character over blocks

- **WHEN** the post title targeted at a YouTube variant is 101 characters, or empty
- **THEN** the verdict is `blocked`, naming the title field and its limit
- **AND** the number comes from the rule data, cited to the source above

#### Scenario: The description is counted in bytes, not characters

- **WHEN** a YouTube caption's UTF-8 encoding exceeds 5000 bytes while its character count does not
- **THEN** the verdict is `blocked`
- **AND** the counted value is bytes — YouTube's API is the validator, not the Help page

#### Scenario: Tags are counted as one string, YouTube's way

- **WHEN** a variant's hashtags target YouTube
- **THEN** the total is measured across all tags including the commas between them and the quotes
  YouTube counts for tags containing spaces
- **AND** 500 characters is the ceiling for the whole list, not a per-tag limit

#### Scenario: A non-video file cannot target YouTube

- **WHEN** a YouTube variant carries an image, audio or other non-video media
- **THEN** the verdict is `blocked`, naming the media requirement
- **AND** more than one media item is refused the same way — YouTube v1 uploads one video

## MODIFIED Requirements

### Requirement: Counting matches the platform's own arithmetic

The caption counter SHALL use each platform's counting rule — link handling where a platform prices
links, byte arithmetic where the platform counts bytes — rather than counting characters. A counter
that disagrees with the platform turns a working post into a rejection.

#### Scenario: A YouTube caption is counted in UTF-8 bytes

- **WHEN** a caption targeting YouTube contains multi-byte characters
- **THEN** the counted length is the byte length of the encoded caption plus hashtags
- **AND** a description that fits in 5000 characters but not 5000 bytes is over budget

#### Scenario: A URL counts as its literal characters where no platform prices links

- **WHEN** a caption contains a URL on a platform with no link pricing
- **THEN** the counted length is the URL's own characters
- **AND** no fixed link cost applies — X, which had one, left the lineup on 2026-11-17

#### Scenario: Hashtags count against the budget where the platform puts them

- **WHEN** hashtags are placed in the caption for Threads or YouTube
- **THEN** they are included in the counted length
- **AND** for Instagram, where they belong in the first comment, the caption budget excludes them

#### Scenario: The ceiling is the platform's, not a round number

- **WHEN** a caption is validated for a platform
- **THEN** the ceiling is that platform's documented limit
- **AND** a caption one character over is `blocked`, not warned
