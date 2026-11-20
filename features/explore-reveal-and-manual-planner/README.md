# explore-reveal-and-manual-planner

## Goal

**Explore shows opportunities. Plan route only helps connect them.**

"Explore this area" becomes a one-tap game mechanic that reveals the Flowlines of the
visible map area. Route planning becomes a separate, manual planner. Staza does not
generate a "best route" on its own, so Explore does not turn back into a
Strava/Komoot-style route generator.

```text
World → Explore this area → Flowlines revealed → Inspect Flowlines → Choose targets
→ Plan route (optional) → Ride → Complete Flowlines / Collectibles
→ XP / Quest / Progress / Skill Atlas → Back to World
```

This supersedes the route-first entry point of
[explore-this-area](../explore-this-area/README.md). It also replaces the top-5 reveal
on Generate from [hidden-flowline-discovery](../hidden-flowline-discovery/README.md).

## Starting point

- Reveals are stored in `player_flowline_reveals` (migration 041) and handled by
  `FlowlineRevealRepository`. Today `selectFlowlinesToReveal` reveals the top 5 by
  `flowScore` as a side effect of `POST /api/explorations/generate`.
- `GET /api/world` returns revealed Flowlines and `hiddenFlowlineCount`.
- Activity persistence already reveals ridden Flowlines (source `ride`) and sets the
  `hiddenFound` flag.
- Each Flowline has `flowScore`, `enduranceScore`, `exploreScore`,
  `roadQualityScore`, `dataConfidence` and `lengthMeters`.
- The planner supports generate (automatic proposals), reroute (fixed target set,
  cheapest insertion, arbitrary waypoints) and confirm (QuestInstance + PlannedRoute).
  A route can require only one Flowline (`destinationFlowlineId`).
- Clients: web (`public/components/world-page.js`, `world/exploration-panel.js`,
  `world/fartlek-detail.js`) and iOS (`ios/Staza/Features/World/*`).

## Scope

In:

- Web and iOS clients.
- A reveal-only Explore action.
- Derived area status.
- Flowline character tags.
- Reveal moment and its result states.
- Flowline detail card.
- Discoveries panel.
- Manual multi-stop planner.
- Activity reveal label.
- en/de strings.
- Docs and e2e test.

Out:

- Android (it has no World map).
- A persisted table of explored areas.
- "Refresh area".
- Changes to Flowline extraction or scoring.

## Decisions

- **World states:** a Flowline is Hidden, Revealed or Completed. Revealed is a
  separate, permanent world state. It counts as discovered but not as completed.
- **Reveal amount:** one Explore reveals every eligible unrevealed Flowline in the
  frozen viewport bbox, up to 12.
  - Eligible means published and above the quality and data-confidence thresholds.
  - Order: primary score descending, then id ascending.
  - Collectibles are not affected.
- **Explored state is derived, not stored:**
  - `known` = revealed Flowlines in the bbox.
  - `available` = eligible unrevealed Flowlines in the bbox.
  - The Explore call uses the same eligibility rule, so the button state and the result
    always agree.
- **Area size limit:** an area wider than 50 km (`MAX_EXPLORE_WIDTH_METERS`) cannot be
  explored; the button reads "Zoom in to explore" and does nothing.
- **Eligibility thresholds** (`src/flowlineReveal.ts`): primary score ≥ 50, road quality
  ≥ 40 and data confidence ≥ 40 when known.
- **Flowline character:** fixed thresholds per score give a set of tags (`flow`,
  `endurance`, `explore`; thresholds 70 / 65 / 65 in `src/flowlineCharacter.ts`). The
  primary character is the qualifying tag with the highest score; a Flowline without a
  qualifying tag falls back to its highest score.
- **Planner:** manual. Staza orders the stops (cheapest insertion + 2-opt), and the
  user can reorder them; once reordered, the order is kept (`keepOrder`). Limits per
  route: 4 Flowlines, 12 collectibles, 8 waypoints. The existing automatic generator stays only as an optional
  **Suggest route** action inside the planner. It uses revealed Flowlines only.
- **End of planning:** **Start Exploration** still persists one QuestInstance and one
  PlannedRoute. Each included Flowline adds one `flowline_rule` objective.
- **Gameplay truth:** planning never reveals, completes or awards anything. Only Explore
  reveals, and only activities complete.
- **Generate:** `POST /api/explorations/generate` no longer reveals anything.

## UX (web and iOS)

1. **World default**
   - Collectibles (places, peaks, castles, viewpoints, passes) are always visible.
   - Revealed Flowlines are visible. Hidden Flowlines are not drawn.
   - Primary action: the state-driven Explore button. Next to it, a small secondary
     **Plan route** button.
2. **Main button states**

   | Situation | Label | Action |
   |---|---|---|
   | Zoom too low | Zoom in to explore | None (disabled) |
   | Nothing revealed in the area yet | Explore this area | Explore |
   | Some known, new ones available | Explore for new Flowlines | Explore |
   | Everything known | Show Flowlines | Frame known Flowlines |

3. **Explore**
   - Freeze the viewport bbox.
   - Show "Exploring this area…".
   - Call the explore endpoint. There is no wizard, distance choice or ride style.
4. **Reveal moment**
   - Show "N Flowlines discovered".
   - The new Flowlines appear one after another with a subtle animation that respects
     reduced motion.
   - Then a summary appears: total, plus counts per primary character, e.g.
     "3 high-flow, 2 endurance, 2 exploration".
   - Actions: **View discoveries**, **Plan a route**, and close (Done / X).
5. **Nothing found**
   - Message: "Nothing new discovered here. Try exploring a wider area or another
     region."
   - Actions: **Zoom out**, **Explore another area** (closes the card).
   - World objects stay visible.
6. **Area already explored**
   - Flowlines that are already known are not "discovered" again.
   - Message: "Area already explored. K Flowlines known, M new opportunities
     available". Any new eligible Flowlines are revealed by the same call.
   - Action: **Show known Flowlines**.
7. **Flowline detail card**
   - Shows: name, length, primary character badge, primary score (e.g. "Flow 84"),
     road quality, and status (Unridden / Completed).
   - At most two scores at a time.
   - A "Best for" tag list appears when the Flowline has several tags.
   - Actions: **Add to route**, **View details**.
8. **View discoveries** (side panel on web, bottom sheet on iOS)
   - Title: "Discovered in this area".
   - Counts for Flowlines and each collectible category in the bbox.
   - Flowline list, with sorting by Best Flow, Best Endurance, Unridden and Nearby.
   - Each card: **View on map**, **Add to route**.
   - A **Plan a route** action opens the planner with the stops added so far (the
     panel can cover the map's Plan route button on smaller screens).
9. **Plan a route** (manual planner)
   - Start point: the last located position, or a point picked on the map.
   - Roundtrip, or an optional end point.
   - Revealed Flowlines are highlighted, and collectibles are visible.
   - Actions: **Add Flowline**, **Add Collectible**, **Add waypoint** (map click),
     **Route**, optional **Suggest route**, reorder stops, **Start Exploration**.
   - Flowlines added with "Add to route" are preloaded as stops.
10. **Activity reveal**
    - When a ride crosses a previously hidden Flowline, the activity shows "New Flowline
      discovered".
    - The Flowline goes Hidden → Revealed → Completed in the same activity, so Explore
      is never required.

## API

- `GET /api/world`
  - Adds `areaStatus: { knownFlowlines, availableFlowlines, exploreAllowed }`.
  - Each Flowline adds `character: { primary, tags }` and `completed`.
  - Unrevealed Flowlines never include geometry.
- New `POST /api/world/explore` `{ bbox: "minLon,minLat,maxLon,maxLat" }`
  - Requires auth and CSRF. Rate limited. Areas wider than 50 km are rejected (400).
  - Returns `{ outcome, revealed, knownCount, availableCount, summary: { total,
    byCharacter } }`.
    - `outcome`: `discovered` (nothing was known before), `already_explored_new`
      (known Flowlines plus new reveals), `already_explored` (all known, nothing new),
      `nothing_new` (nothing known, nothing eligible).
    - `knownCount` includes this call's reveals; `availableCount` is what remains hidden
      beyond the cap of 12.
  - Idempotent. Reveals are persisted with source `explore`.
  - Collectible counts for the discoveries panel come from the World viewport payload.
- New `POST /api/explorations/plan` `{ area: { bbox, center, zoom }, sport, start,
  routeType, end?, keepOrder, stops }`
  - Each stop is `{ kind: "flowline" | "collectible", id }` or `{ kind: "waypoint",
    lat, lon }`.
  - Returns `{ explorationId, proposal }`. `proposal.stopOrder` lists the routed order
    (`flowline:<id>`, collectible id, `waypoint:<lat>,<lon>` with six decimals);
    `droppedFlowlineIds`, `droppedTargetIds` and `droppedWaypoints` list unreachable
    stops. An unroutable plan returns 422 `no_route`.
  - Every Flowline stop must be revealed, and each is ridden in full: enter at the
    nearer endpoint, then check the 30 m corridor with at least 80 % coverage.
  - Every edit re-plans with the full stop list. "Suggest route" calls generate, whose
    recommended proposal becomes the stop list.
- `POST /api/explorations/confirm` `{ proposalId }` is unchanged; expired proposals
  return `proposal_expired` / `exploration_expired` and clients clear the result.

## Implementation plan

1. **Flowline character:** pure classifier (thresholds, tags, primary) with tests.
   Expose it on the World Flowline payload.
2. **Reveal policy:** eligibility filter, cap of 12, ordering, area-status computation
   and minimum-zoom rule, with tests.
3. **Explore endpoint:**
   - Add `POST /api/world/explore` and `areaStatus` on `/api/world`.
   - Remove the reveal from generate.
   - Add repository count queries, with tests.
4. **Manual planner:**
   - Plan endpoint with mixed stops and multiple required Flowlines.
   - Cheapest insertion plus reorder.
   - One `flowline_rule` objective per Flowline on confirm, with tests.
5. **Web World:** state-driven button and Plan route button, exploring state, reveal
   moment, summary, and the nothing-new and already-explored cards.
6. **Web card and discoveries:** Flowline detail card, discoveries panel with sorting,
   Add-to-route selection.
7. **Web planner:** rework the exploration panel into the manual planner, with Suggest
   route and Start Exploration.
8. **iOS World:** button states, reveal moment, summary, and the empty and
   already-explored states.
9. **iOS card and discoveries:** detail card and discoveries sheet.
10. **iOS planner:** manual planner.
11. **Activity label:** "New Flowline discovered" for `hiddenFound` on web and iOS.
12. **Strings, docs, e2e:**
    - en/de strings in `public/app-locales.js` and `Localizable.xcstrings`.
    - Amend the explore-this-area and hidden-flowline-discovery docs.
    - Playwright test for explore → reveal → plan.

## Acceptance criteria

- **First Explore:** on an unexplored area with eligible Flowlines, Explore reveals up
  to 12 of them. Then:
  - The summary shows the counts per character.
  - The Flowlines stay visible after a reload.
- **Repeat Explore:** in the same area it never re-reveals known Flowlines. It reports
  "already explored" and reveals only new eligible Flowlines.
- **Nothing found:** an area with no eligible Flowlines shows the "Nothing new
  discovered here" state with Zoom out and Explore another area.
- **Button states:** the main button label always matches `areaStatus`. Below the
  minimum zoom it reads "Zoom in to explore".
- **No geometry leaks:** no response contains geometry of unrevealed Flowlines.
- **Detail card:** shows the primary character and no more than two scores.
- **Discoveries panel:** lists the area counts and sorts Flowlines by each option.
- **Manual planner:**
  - Builds a route through the chosen Flowlines, collectibles and waypoints without
    choosing targets on its own. Suggest route is optional.
  - Every included Flowline is ridden in full.
  - Confirming creates one `flowline_rule` objective per Flowline.
- **Ride reveal:** riding a hidden Flowline reveals and completes it in the same
  activity, labelled "New Flowline discovered".
- **Planning is not gameplay:** planning never reveals or completes anything.

## Constraints

- Keep eligibility, character and minimum-zoom thresholds as named constants. They
  will be tuned against real data.
- Keep the Explore animation subtle.
- Preserve existing quest instances, planned routes and reveals.

## Validation

- Unit tests: character classifier, reveal policy, area status, explore endpoint,
  multi-stop planner, and confirm objectives.
- Web client tests: World button states, reveal and summary states, detail card,
  discoveries panel, and planner.
- iOS unit tests: World, Explore and planner models, and decoding.
- `npm test`, `npm run build`, and the Playwright e2e `e2e/explore-reveal.e2e.ts`
  (stubs the World, explore and plan responses so it runs against any database).

## Code map

- Server: `src/flowlineCharacter.ts` (classifier), `src/flowlineReveal.ts` (eligibility,
  area status, outcome), `src/worldExplore.ts` (explore endpoint logic),
  `src/routePlanning/manual.ts` (manual stops, ordering, routing),
  `src/exploration/service.ts` (`plan`, `generate` without reveal).
- Web: `public/components/world/explore-reveal.js` (button state, result card,
  discoveries), `world/route-planner.js` (planner state and plan body),
  `world/route-format.js`, wired in `public/components/world-page.js`.
- iOS (`ios/Staza/Features/World/`): `FlowlineReveal.swift` (character, explore result,
  button action, discovery sorting), `ExploreRevealViews.swift` (button overlay, result
  card, discoveries sheet), `RoutePlannerModel.swift` / `RoutePlannerPanel.swift`
  (manual planner), `WorldDetailView.swift` (Flowline card), `WorldModel.swift`
  (`exploreArea`, staggered reveal).
