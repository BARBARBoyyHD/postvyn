## ADDED Requirements

### Requirement: Brands are data, and they own the theme

A brand SHALL be creatable and editable with a name, a slug, an optional handle, a voice block and a
colour block. The active brand's colours SHALL be applied as CSS custom properties, so no component
carries a hardcoded accent.

#### Scenario: Creating a brand makes it selectable

- **WHEN** an operator creates a brand with a unique slug in their workspace
- **THEN** the brand is listed for that workspace
- **AND** duplicate slugs within the workspace are refused

#### Scenario: Colours reach the content surfaces as variables

- **WHEN** a brand becomes the active brand
- **THEN** its accent and plate colours are exposed as CSS custom properties to the content surfaces
  (post cards, caption preview, variant preview)
- **AND** switching brand changes them without a reload

### Requirement: The product's own identity is Zavron and never changes

The application's chrome — navigation, buttons, dialogs, empty states, sign-in, footer — SHALL carry
Zavron's identity, and that identity MUST NOT be replaced by the active brand's palette. A tool that
repaints itself as a client's brand stops being legible as Zavron's product.

#### Scenario: Switching brand does not repaint the app

- **WHEN** the operator switches from Zavron to another brand
- **THEN** the chrome keeps the Zavron accent and plates
- **AND** only content surfaces take the new brand's colours

#### Scenario: Ownership is legible without asking

- **WHEN** any screen is open, signed in or not
- **THEN** the Zavron wordmark is present on the sign-in screen and in the app chrome
- **AND** the footer identifies Zavron as the maker

#### Scenario: A brand with no palette still renders

- **WHEN** the active brand has no colour block
- **THEN** content surfaces fall back to the Zavron palette
- **AND** nothing renders with an undefined colour

#### Scenario: Another workspace's brand is not creatable underneath

- **WHEN** a create request names a brand id or workspace that belongs to another workspace
- **THEN** the request is refused
- **AND** nothing is written

### Requirement: Switching brand scopes everything downstream

The active brand SHALL be part of the resolved context, so board, composer and theme all read the
same brand. A stale brand selection MUST NOT survive into a request for a brand the user cannot see.

#### Scenario: The board follows the switcher

- **WHEN** the operator switches from brand A to brand B
- **THEN** the board shows only brand B's posts
- **AND** the theme reflects brand B's colours

#### Scenario: A brand from another workspace is rejected

- **WHEN** the active brand id in the session no longer belongs to the user's workspace
- **THEN** the context falls back to the workspace's first brand
- **AND** no data from the foreign brand is returned

### Requirement: Voice is data the caption writer reads

The brand's `voice` block SHALL be stored as JSON and exposed to the authoring surface as structured
guidance, not as free text a renderer might ignore.

#### Scenario: Voice survives a round trip

- **WHEN** a brand is saved with a voice block and read back
- **THEN** the same structure is returned
- **AND** an absent voice block reads as empty rather than throwing
