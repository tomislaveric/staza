# world-filter

## Goal

Unify World map filters and marker guidance so the map's active controls use the same visual vocabulary as the markers, with no separate overlay legend.

## Scope

- Replace the current single-select filter tabs with multi-select controls for Found, Unfound, Rare, Epic, Fartleks, Viewpoint, Peak, Castle, Waterfall, and Place.
- Show the existing marker swatch alongside each control: yellow for Found, rarity rings for Rare/Epic, category colors for collectible categories, and a blue horizontal line for Fartleks.
- Remove the map-overlay legend and its associated styling.
- Keep filtering client-side against the existing World snapshot and preserve existing API, map feature data, quest, and detail behavior.

## Decisions

- Multi-select uses union semantics: an item remains visible when it matches any selected filter.
- All is the reset state when no filters are selected.
- Add category controls for all five categories represented in the existing map legend: Viewpoint, Peak, Castle, Waterfall, and Place.
- Fartlek completion remains represented by the map marker color, not a separate filter.
- Preserve accessible button state, labels, keyboard interaction, and focus styling.

## Implementation plan

1. Replace the single active-filter value with selected-filter state and implement union matching for discovery, rarity, Fartlek, and collectible category filters.
2. Render the existing swatches in the filter controls, wire selection and reset interactions, and remove the obsolete legend from the map shell and styles.
3. Update focused World page tests for combined filters, category coverage, marker affordances, and legend removal.

## Acceptance criteria

- The World map has one set of filter controls; there is no separate marker-legend overlay.
- Controls display map-consistent marker swatches and include every supported collectible category as well as the existing Found, Unfound, Rare, Epic, and Fartleks filters.
- Multiple selected filters show the union of their matching map items; clearing all selections returns the map to the All state.
- Existing map selection, quest, and detail behavior remains intact.
- Filter controls remain accessible and responsive at mobile widths.

## Constraints

- Do not change the World API, server-side filtering, map feature schema, or unrelated World behavior.
- Reuse the existing swatch vocabulary and category mapping; do not introduce new marker encodings.

## Implementation

- World controls are native toggle buttons with `aria-pressed`; All resets the selected filters.
- Selected filters match a union against the current snapshot. Category matching uses the same `primaryCategory`, `type`, and default fallback as map features.
- Controls reuse collectible and Fartlek swatches and wrap at narrow widths. Active controls use a neutral surface with a yellow outline to preserve swatch colors.
- Selected quest collectibles remain mapped alongside filtered items, without duplicates. The separate legend and its styles are removed.

## Validation

- Run focused World page and marker/filter tests.
- Verify union behavior for both collectible and Fartlek features, each category filter, and the empty-selection All state.
- Verify the map shell no longer renders the overlay legend and confirm existing quest/selection tests remain passing.
