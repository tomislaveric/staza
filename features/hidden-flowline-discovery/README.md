# hidden-flowline-discovery

## Goal

Flowlines are hidden world opportunities, not globally visible map features.
They are precomputed globally and revealed per player. They are never computed
dynamically while planning.

Gameplay loop:

World → Explore this Area (Generate Routes) → Flowlines revealed → pick one / plan route →
ride → complete Flowline → XP / quest progress / Skill Atlas.

Benefits: stable Flowline ids, existing segment intelligence preserved, cheaper World
queries, a real discovery loop, and a clear link between World and route planning.

## Starting point

- Flowlines are stored in the `fartleks` table. The OSM import precomputes them, with
  road-cycling segment scores: `flow_score`, `endurance_score`, `explore_score`. This
  feature does not change extraction or scoring.
- `GET /api/world` returns every published Flowline in the viewport to every player,
  thinned by `flowlinePolicyForBounds`.
- `POST /api/explorations/generate` loads all Flowlines in the area. Cycling routes snap
  toward them, and proposals report `traversedFlowlines`. Flowlines are never targets.
- Activity processing completes any published Flowline (`fartlek_completions`).
- The `flowline_rule` quest objective already exists.

## Scope

In:

- Per-player reveal state.
- Revealing Flowlines on Generate.
- Revealing Flowlines by riding them.
- A hidden-count teaser on the World map.
- Using a revealed Flowline as a route's required target.
- Web and iOS clients.

Out:

- Android: it has no World map.
- Adding or removing Flowlines during reroute.
- Reveal by proximity.
- Reveal decay.
- Changes to Flowline extraction or scoring.

## Decisions

- **Reveal trigger:** pressing **Generate Routes** in Explore this Area reveals Flowlines
  of the frozen bbox.
- **Reveal amount:** each Generate reveals a curated top N of the frozen bbox:
  - N = 5.
  - Candidates are unrevealed published Flowlines that intersect the bbox.
  - Order: `flowScore` descending, then id ascending.
- **Persistence timing:** reveals persist immediately on Generate and are idempotent,
  even if routing then fails. Discovery is world state, not a plan. This amends
  explore-this-area rule 6 ("nothing persisted before Start Exploration").
- **Riding a hidden Flowline:** it still completes and awards XP as before. It is also
  revealed (source `ride`), and the completion is flagged `hiddenFound`. Clients label it
  "Hidden Flowline found".
- **World map:** only revealed Flowlines are drawn. Hidden ones appear only as a teaser
  count ("N hidden Flowlines here"), never as geometry.
- **No geometry leaks:** planner snapping and `traversedFlowlines` use only revealed
  Flowlines, including those revealed by the current Generate.
- **Backfill:** every Flowline a player has already completed is revealed with source
  `ride`.
- **Lifetime:** reveals are permanent; deleting an activity does not hide a Flowline
  again. Player reset and account deletion remove reveals.
- **Quest targets:** `GET /api/world/quest-targets` stays unfiltered, because it only
  loads ids the player's quests already reference.
- **Pick one / plan route:** a revealed Flowline can be the route's required target. The
  player picks it in one of two places:
  - Flowline detail: "Plan route via this Flowline".
  - The revealed list in the explore panel.

  Picking it regenerates routes with `destinationFlowlineId`. The route must ride the
  Flowline fully. Confirming the route creates a `flowline_rule` objective with
  `requiredCount: 1`. Completion still comes only from the imported activity.

## Design

### Data

Migration `041_player_flowline_reveals`:

```sql
CREATE TABLE player_flowline_reveals (
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  fartlek_id TEXT NOT NULL REFERENCES fartleks(id) ON DELETE CASCADE,
  revealed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL CHECK (source IN ('explore', 'ride')),
  PRIMARY KEY (player_id, fartlek_id)
);
```

The migration backfills reveals from `fartlek_completions`: one row per distinct
(player, Flowline), using the earliest `completed_at` and source `ride`. The table is
also added to the `resetPlayerData` list.

`FlowlineRevealRepository` provides:

- reading revealed ids
- revealing ids idempotently and returning the newly revealed ones
- listing revealed Flowlines in bounds with the viewport policy
- counting hidden Flowlines in bounds
- listing reveal candidates in bounds

### Reveal policy

A pure function in `src/flowlineReveal.ts`:

```ts
selectFlowlinesToReveal(candidates, revealedIds, n)
```

It returns the top N unrevealed candidates, ordered by `flowScore` descending, then id
ascending.

### API

- `GET /api/world`: `fartleks` contains only revealed Flowlines, still thinned by the
  existing viewport policy. A new field, `hiddenFlowlineCount`, counts the unrevealed
  published Flowlines in the viewport.
- `POST /api/explorations/generate`:
  - Reveals the top N first, then plans with only revealed Flowlines.
  - The response adds `revealedFlowlineIds`, the Flowlines newly revealed by this call.
  - `catalog.flowlines` contains the revealed Flowlines of the area.
  - Accepts an optional `destinationFlowlineId`. It must be revealed and intersect the
    bbox, and it cannot be combined with `destinationId`.
- Activity results and replay: a completion of a previously unrevealed Flowline is
  flagged `hiddenFound: true`. The Flowline is revealed (source `ride`) in the same
  persistence transaction.

### Planner

`generateAreaRoutes` gains a required-Flowline mode:

- Stops run from the nearer Flowline endpoint to the farther one, then the loop is
  closed with the existing loop sides anchored at the Flowline's exit end, so the route
  rides the Flowline once instead of turning back on it.
- Proposals whose geometry does not traverse the Flowline (30 m corridor, ≥ 80 %
  coverage) are discarded. If none remain, generation fails with `no_route`.
- Confirming persists a `flowline_rule` objective that targets the Flowline.

### Clients (web and iOS)

- **World:** draw only the returned Flowlines. When the viewport has hidden Flowlines,
  show a "N hidden Flowlines here — Explore this Area" teaser.
- **Explore:** after Generate, show a "Flowlines revealed" section that lists the area's
  revealed Flowlines with the newly revealed ones first, tagged "New". Each row has
  "Plan route via this", which regenerates the same area with that Flowline as the
  required target; the reveal moment survives the re-plan. "Along this route" is
  unchanged. The World map reloads after new reveals.
- **Flowline detail:** "Plan route via this Flowline" opens Explore over an area framing
  the Flowline (and the player's location when known) with the Flowline preselected.
- **Activity detail / replay:** label `hiddenFound` completions "Hidden Flowline found".
- **Strings:** use the existing localization files.

## Implementation plan

1. Add migration 041 with the backfill, and add the table to `resetPlayerData`.
2. Add `FlowlineRevealRepository` and its tests.
3. Add the pure reveal policy and its tests.
4. Change `/api/world` to return revealed Flowlines only, plus `hiddenFlowlineCount`.
5. Make Generate reveal the top N, plan with revealed Flowlines only, and return
   `revealedFlowlineIds`.
6. Add the required-Flowline planner mode, `destinationFlowlineId`, and the
   `flowline_rule` objective on confirm, with tests.
7. Reveal ridden Flowlines during activity persistence and flag `hiddenFound`, with
   tests.
8. Web client: teaser, reveal moment, plan via Flowline, and the hidden-found label,
   with tests.
9. iOS client: the same UX, with tests.
10. Docs: amend explore-this-area rule 6 (reveals persist on Generate). Also amend its
    statement that Flowlines are never targets: an explicitly chosen revealed Flowline
    can now be a required target.

## Acceptance criteria

- A new player sees no Flowline geometry on the World map, only the hidden count.
- Generate in an area reveals at most 5 previously unrevealed Flowlines (best
  `flowScore` first). It returns their ids, and they then appear on the World map.
  Repeating Generate reveals the next best ones.
- Routes, proposals and `traversedFlowlines` never reference unrevealed Flowlines.
- Riding an unrevealed Flowline completes it, awards XP, reveals it, and marks it
  "Hidden Flowline found".
- Existing completions remain visible after the migration.
- Planning with `destinationFlowlineId` returns only routes that ride the Flowline. It
  rejects unrevealed Flowlines and Flowlines outside the area. Confirming creates a
  `flowline_rule` objective that the next qualifying activity completes.
- Player reset clears reveals.

## Validation

- Unit tests: the reveal policy, the repository, the planner's required-Flowline mode,
  exploration service reveal behaviour, activity reveal and the `hiddenFound` flag, and
  the world-map and exploration-panel client tests.
- `npm test` and the build.
- iOS unit tests for the World model and decoding.
- Targeted Playwright e2e for the World and Explore flow.
