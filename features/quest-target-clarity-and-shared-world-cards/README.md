# quest-target-clarity-and-shared-world-cards

## Goal

Make each curated quest's actual scope clear before and after it is started.
World quest cards list the eligible Flowlines and collectible targets beneath
the description, explain the required count and any conditions, and share one
card structure across recommendation and instance states. Selecting a card
highlights all of its targets on the World map and frames them together.

## Scope

- Review curated quest templates and objective generation/evaluation for copy
  that accurately reflects frozen target scope.
- Keep recommendation and started/completed sections distinct while using the
  same World quest-card structure.
- Show specific Flowlines, places, collectibles, and other objective targets
  beneath each quest description.
- Distinguish the required count from the number of eligible targets.
- Allow selecting a recommendation or started/completed quest to highlight all
  its targets and frame them on the map, even outside the current viewport or
  active filters.
- Keep quest Start and Cancel actions separate from selecting a quest.

Home active-quest cards are out of scope.

## Decisions

| Topic | Decision |
|---|---|
| Subset objectives | Preserve current semantics: a rule objective may require a subset of its listed eligible targets. Clearly communicate, for example, “Complete 5 of these 7 Flowlines.” |
| Existing objective rules | Retain valid length, average-speed, same-Activity, collectible-category, and named-target rules. Clarify mismatched copy rather than changing gameplay semantics. |
| Card states | Preserve separate recommendation and running-quest sections. Share presentation and target-list structure; keep Start, progress, completion, and Cancel state-specific. |
| Quest selection | Selection is distinct from Start/Cancel. Selecting a quest highlights its generated/frozen targets; selecting it again or clearing selection restores ordinary map emphasis. |
| Map behavior | Highlight collectible points and Flowline geometries together and automatically frame all targets. Resolve geometry by target ID when it is not present in viewport-bounded data. |
| Trust boundary | Keep server-side generation, validation, frozen objective scope, and progress evaluation authoritative. |

## Implementation plan

1. Review `fixtures/quest-templates.json` and `src/questTemplates.ts` for
   template, generation, and evaluation consistency. Preserve valid objective
   behavior and clarify only misleading descriptions or labels.
2. Refactor `public/components/world/quest-list.js` to share the core card
   structure between recommendations and quest instances. Under each
   description, list all eligible target names with objective icons, required
   counts, and applicable conditions. Show target completion and aggregate
   progress only for started/completed instances; keep their lifecycle actions
   specific to their state.
3. Wire quest selection in `public/components/world-page.js` to the map. Obtain
   all selected target geometries independent of viewport and filter state,
   reusing `CollectibleRepository.listByIds` and `FartlekRepository.listByIds`
   where appropriate. Extend map feature/layer helpers and `world-map.js` as
   needed to highlight all target types and frame their combined bounds without
   breaking individual marker selection.
4. Update `public/styles/world.css`, focused World quest/card/map tests, and
   this feature documentation to cover target lists, subset semantics, quest
   selection, target highlighting, and map framing.

## Acceptance criteria

- Both recommendations and started/completed World cards list every eligible
  or frozen target below the description.
- Subset objectives explicitly state how many targets must be completed and
  how many are available; length, speed, and same-Activity requirements remain
  visible.
- Named-target and category-count objectives make their place/collectible
  targets identifiable.
- Recommendation cards show no tracked progress; started/completed cards show
  progress and per-target state in the same card structure.
- Start and Cancel controls retain their existing behavior and do not
  accidentally select or deselect a quest.
- Selecting any World quest highlights all associated collectible and
  Flowline targets and frames the complete set, including targets outside the
  current viewport or hidden by filters.
- Clearing quest selection restores regular map emphasis and filter behavior.
- Existing server-authoritative quest generation, frozen target scope, and
  progress evaluation remain unchanged.
- Home quest cards and unrelated worktree changes remain untouched.

## Validation

- Test rendered recommendation, active, and completed cards for complete
  target lists, subset counts, objective qualifiers, and state-specific
  controls/progress.
- Test quest selection and clearing, collectible and Flowline target
  highlighting, targets outside the current viewport, filter-independent
  inclusion, and framing of all target geometries.
- Run the focused World quest/map tests and TypeScript build; run broader tests
  if focused validation reveals regressions.

## Constraints

- Do not change quest semantics, thresholds, or progress rules merely to match
  presentation.
- Do not trust client-provided target scope or progress.
- Do not rely solely on viewport-bounded World data to render a selected
  instance's frozen targets.
- Do not add Home-card changes, rewards, or unrelated quest behavior.
