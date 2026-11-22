# explore-reveal-and-manual-planner

> **Amended by [route-generation-v2](../route-generation-v2/README.md).** Explore is always
> available: a viewport wider than 50 km or taller than 100 km is clamped to a centered frame
> instead of being rejected, so "Zoom in to explore" is gone. Generate route takes an intent
> (Flow / Chill / Explore) and returns exactly one route.
>
> **Amended by
> [explore-sessions-and-saved-explorations](../explore-sessions-and-saved-explorations/README.md).**
> Explore no longer persists reveals: it returns the area's Flowline and uncollected
> Collectible opportunities for a temporary session only (`discovered` | `nothing_new`;
> `known` and `already_explored*` are gone). **Generate route** is the primary action after
> Explore, and the planner ends with **Save Exploration** (`planned`). Starting is a separate
> action in the Explorations list. Progress accumulates across activities
> (`partially_completed` → `completed`); `failed` and Retry are removed.

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
- A light World map: only completed Flowlines load with the viewport.
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
- **Light map, Flowlines on demand (performance decision):**
  - The viewport (`GET /api/world`) only loads collectibles and the player's
    **completed** Flowlines. It runs no hidden-Flowline scan and returns no per-viewport
    counts.
  - Revealed but unridden Flowlines load only through Explore. They then stay on the
    map for the rest of the session.
  - There is no stored explored-area record. Explore itself reports whether the area
    was already explored.
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
  route: 4 Flowlines, 12 collectibles, 8 waypoints (all removed later by explore-sessions-and-saved-explorations). The existing automatic generator stays only as an optional
  **Suggest route** action inside the planner. It uses revealed Flowlines only.
- **End of planning:** **Start Exploration** still persists one QuestInstance and one
  PlannedRoute. Each included Flowline adds one `flowline_rule` objective.
- **Gameplay truth:** planning never reveals, completes or awards anything. Only Explore
  reveals, and only activities complete.
- **Generate:** `POST /api/explorations/generate` no longer reveals anything.

## UX (web and iOS)

1. **World default**
   - Collectibles (places, peaks, castles, viewpoints, passes) are always visible.
   - Completed Flowlines (yellow) are visible. Revealed but unridden Flowlines (blue)
     appear only after Explore in that area. Hidden Flowlines are never drawn.
   - No visible-area counts that change with every pan.
   - Primary action: the Explore button. Next to it, a small secondary **Plan route**
     button.
2. **Main button states**

   | Situation | Label | Action |
   |---|---|---|
   | Area wider than 50 km | Zoom in to explore | None (disabled) |
   | Otherwise | Explore this area ("Erkunden" on iOS) | Explore |

   - Explore in an already explored area shows its known Flowlines and reveals only
     new eligible ones. It never repeats a discovery.

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
   - iOS: there is no map overlay. Explore and an icon-only Plan route button sit in
     the World sheet header. When Explore finishes, the sheet moves to half height
     and shows the discoveries with the result at the top. The map frames the new
     Flowlines and highlights them while the discoveries are open. iOS labels are
     kept short (e.g. "Erkunden") and secondary actions are icon-only.
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
  - `fartleks` holds only the player's completed Flowlines in the bbox.
  - Adds `exploreAllowed` (the bbox is at most 50 km wide). There are no
    `areaStatus` or per-viewport `stats` for a bbox.
  - Each Flowline adds `character: { primary, tags }` and `completed`.
  - Unrevealed Flowlines never include geometry.
- New `POST /api/world/explore` `{ bbox: "minLon,minLat,maxLon,maxLat" }`
  - Requires auth and CSRF. Rate limited. Areas wider than 50 km are rejected (400).
  - Returns `{ outcome, revealed, known, knownCount, availableCount, summary: { total,
    byCharacter } }`.
    - `known`: every revealed Flowline in the area, including `revealed`. Clients draw
      these and list them as discoveries.
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
   - Add `POST /api/world/explore`; `/api/world` loads only completed Flowlines.
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
  - The reveals persist: after a reload, Explore in the same area shows them again
    without re-discovering them.
- **Repeat Explore:** in the same area it never re-reveals known Flowlines. It reports
  "already explored" and reveals only new eligible Flowlines.
- **Nothing found:** an area with no eligible Flowlines shows the "Nothing new
  discovered here" state with Zoom out and Explore another area.
- **Button states:** the main button reads "Explore this area". If the area is wider
  than 50 km, it reads "Zoom in to explore" and is disabled.
- **Light map:** the viewport request returns only completed Flowlines. It runs no
  hidden-Flowline scan and returns no per-viewport counts.
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
  button action, discovery sorting), `ExploreRevealViews.swift` (sheet Explore and Plan
  route buttons, result banner, discoveries sheet), `RoutePlannerModel.swift` / `RoutePlannerPanel.swift`
  (manual planner), `WorldDetailView.swift` (Flowline card), `WorldModel.swift`
  (`exploreArea`, staggered reveal).
