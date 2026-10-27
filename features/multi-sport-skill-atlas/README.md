# Multi-Sport Skill Atlas

Extend the existing cycling Skill Tree into a complete multi-sport **Skill Atlas**:
a premium dark, radial, pannable/zoomable progression map with **Athlete** as the
neutral global root and **Cycling, Running, and Hiking** as three equal first-class
sport sectors, plus cross-sport and prestige nodes.

This is an extension/refactor of the working system — not a rebuild. All gameplay
semantics are preserved: the Skill Point economy, unlock/requirement semantics,
persistence rules, premium gating, server-side enforcement, and the separation
between Quests and Skill Nodes.

## Goal

Turn the cycling-oriented radial tree into a complete multi-sport atlas while
reusing the existing SVG renderer, radial layout, pan/zoom viewport, selection/hover,
detail panel, requirement evaluation, unlock APIs, and persistence. The architecture
must support adding further GPS sports (Walking, MTB, Gravel, XC Skiing, …) without
redesigning the renderer.

## Decisions (approved)

- **Scope:** Full catalog in one pass — extended Cycling, full Running, full Hiking,
  cross-sport, and prestige nodes.
- **Branch keys:** Keep existing cycling branch keys (`rush`/`adventure`/`endurance`)
  for persistence compatibility; add `speed` (Running) and `summit` (Hiking); reuse
  `adventure`/`endurance` as the shared EXPLORE/ENDURANCE branches across sports.
  Display labels: FLOW/SPEED/SUMMIT + EXPLORE + ENDURANCE.
- **Elevation:** Add a per-activity, nullable `elevation_gain_m` column plus ingestion
  and aggregation so hiking/elevation requirements have real data; historical rows stay NULL.
- **Metrics:** Extend `statsQuery.ts` with read-only per-sport metrics. No change to
  the economy, unlock, requirement, or premium semantics.
- **Athlete root:** The non-persisted synthetic `__athlete_root__` node is the center;
  Cycling is no longer the root — it is one sport hub among three.
- **No persisted polar coordinates:** layout stays client-derived; catalog
  `layout:{col,row}` remains for backward compatibility but does not drive the renderer.
- **No new dependencies**, no framework, SVG-only. No generic gameplay buff engine,
  no purchasable Skill Points / XP boosters / pay-to-win shortcuts.

## Structure

- **Ring 0:** Athlete (global root).
- **Ring 1:** Sport hubs — Cycling (`cyclist`, existing id), Running (`runner`), Hiking (`hiker`).
  Sport-hub nodes are tier 1 and free.
- **Rings 2–4:** Branch specialization chains (5 nodes per branch).
- **Rings 5+:** Cross-branch, cross-sport, and prestige / late-game nodes.
- Radial position derives from progression depth (longest prerequisite path);
  angular position derives from sport sector + branch. Cross-sport nodes sit spatially
  between the sectors they connect (circular mean of parent angles) and support
  multiple incoming prerequisites.

### Branches
- **Cycling:** FLOW, EXPLORE, ENDURANCE (+ cross: Fast Explorer, Adventure Endurance,
  Breakaway Specialist, All-Round Cyclist). Existing cycling node IDs/costs preserved.
- **Running:** SPEED, EXPLORE, ENDURANCE (+ cross: Fast Explorer, Trail Endurance,
  Strong Finisher, All-Round Runner).
- **Hiking:** SUMMIT, EXPLORE, ENDURANCE (+ cross: Mountain Explorer, Alpine Endurance,
  Long-Distance Explorer, All-Round Hiker).
- **Cross-sport:** Dual Athlete, Bike & Hike Explorer, Run & Hike Explorer, Endurance
  Hybrid, Mountain Athlete, Multi-Sport Explorer, Weekend Warrior, Triple Discipline,
  Complete Athlete.
- **Prestige:** Cycling (Flow Master, Legendary Explorer, Ultra Cyclist), Running
  (Pace Master, Trail Master, Endurance Legend), Hiking (Summit Master / Wilderness
  Legend, Ultra Hiker), Global (Multi-Sport Legend, World Mover, Complete Athlete).
  Prestige nodes live on outer rings, typically cost more, and grant status/titles/
  badges/quest chains only.

## Requirement model

Requirements remain cumulative lifetime progress and never consume progress; Skill
Points determine the player's choices.

- **Available today:** level, totalXp, total/cycling/running distance, longest
  ride/run, total activity count, cycling Flowlines, unique collectibles, collectible
  category counts (viewpoints/peaks/castles/waterfalls/places/mountain passes).
- **New (read-only, derived):** hiking distance + longest hike; per-sport activity
  counts; sport-scoped collectible discovery (so cycling discoveries don't satisfy
  running/hiking nodes); elevation gain (needs the new column); distinct-sport count
  (cumulative, for Weekend Warrior).
- Flowlines stay cycling-only; Running/Hiking do not reuse cycling Flowlines.

## Interaction & visuals

- **Pan/zoom:** preserved drag-pan, wheel zoom, pinch, zoom in/out, reset/center, fit.
  Initial load frames Athlete + sport hubs + first rings comfortably (not fully zoomed out);
  users can zoom out for the full atlas.
- **Inspection:** every node inspectable in every state (unlocked/unlockable/locked/PRO/
  far-future/blocked). Click/tap selects and updates the persistent right-side detail
  panel; unlocking happens only via the explicit Unlock CTA. Desktop hover shows a compact
  tooltip; touch does not depend on hover; large invisible hit targets; dragging never
  selects.
- **Visual hierarchy:** Athlete (central landmark) > sport hubs > branch nodes, with
  distinct treatments for cross-branch, cross-sport, and prestige nodes; restrained PRO marker.
- **Color:** Staza gold/yellow is the primary progression accent (unlocked = strong gold +
  subtle glow; unlockable = brighter outline; locked = muted charcoal; completed requirement
  may use green but green is never the main unlocked color). Subtle secondary sport accents
  (cyclish cyan / running coral / hiking green).
- **Connectors:** restrained curved SVG progression paths; low weight when locked, gold when
  unlocked; support multiple parents and cross-sector edges; subtle unlock animation that
  respects `prefers-reduced-motion`.
- **Accessibility:** keyboard-focusable nodes, Enter/Space selection, visible focus,
  useful aria-labels, reduced-motion, large targets.
- **Responsive:** desktop viewport + fixed detail panel; smaller screens keep the atlas
  pannable/zoomable with the panel stacking per existing conventions.

## Quest relation

Quests and Skill Nodes stay separate. Nodes unlock via prerequisites + requirements +
Skill Points, and may *grant* access to quest categories/chains, filters, badges, or
titles (e.g. Fondo Rider → Fondo quest chain; Trail Seeker → Trail Running quests;
Multi-Sport Explorer → Cross-Sport quests). Node unlocks never require quest completion
unless such a requirement already exists intentionally.

## Premium

Existing model unchanged: Tier 1 fully free; deeper progression premium-gated. Free
players still earn XP, levels, all progress stats, and Skill Points, and retain them.
Premium unlocks access to deeper node progression only.

## Implementation plan

### Server / domain
1. `src/skillTree/types.ts` — add `"hiking"` to `SkillTreeSport`; add `"speed"` and
   `"summit"` to `SkillTreeBranch`; add new `SkillTreeStats` fields (hiking distance/
   longest, per-sport activity counts, elevation gain, sport-scoped discovery, distinct
   sport count).
2. `src/skillTree/catalog.ts` — add Running, Hiking, cross-sport, and prestige nodes and
   extend cycling chains to the full depth; preserve existing cycling IDs/costs; keep the
   catalog a valid DAG (validator: unique IDs, resolvable prerequisites, no cycles,
   tier-1-free / higher-tier-premium).
3. `src/skillTree/eligibility.ts` — extend `statMetrics` with the new metric keys.
4. `src/skillTree/statsQuery.ts` — add SQL for hiking distance/longest, per-sport activity
   counts, sport-scoped collectible discovery, elevation aggregation, and distinct sport count.

### Elevation pipeline (only schema change)
5. `src/persistence/migrations.ts` — new migration adding nullable
   `activities.elevation_gain_m` with a non-negative check.
6. `src/domain.ts` — add optional `elevationGainM` to the canonical activity type.
7. `src/strava/service.ts` + canonical processor + `src/persistence/activityRepository.ts`
   INSERT — source elevation from Strava `total_elevation_gain` at import and thread it to
   the activities INSERT; other sources populate when available, else NULL.

### Frontend
8. `public/components/skill-atlas-visual-config.js` — extend `BRANCH_ORDER` with
   `speed`/`summit`; cover FLOW/SPEED/SUMMIT/EXPLORE/ENDURANCE in `BRANCH_LABELS`;
   confirm subtle per-sport accents.
9. `public/components/skill-atlas-layout.js` — confirm data-driven per-sport branch sets;
   add visual-type role hints for cross-branch/cross-sport/prestige nodes if needed.
10. `public/components/skill-atlas-render.js` — visual hierarchy for cross-branch/
    cross-sport/prestige node types; keep the PRO marker restrained.
11. `public/components/skill-atlas-viewport.js` — initial-load framing of Athlete + hubs +
    first rings instead of a full fit; keep the fit control.
12. `public/styles/skill-tree.css` — styling for new node types, sport accents, connector
    weights, and header copy.

## Acceptance criteria

- Athlete renders at the center as the strongest landmark; Cycling, Running, and Hiking
  appear as three equal sport hubs splitting the circle.
- The full catalog validates (unique IDs, resolvable prerequisites, no cycles, tier-1 free /
  higher-tier premium); all existing cycling node IDs and costs are unchanged.
- Running and Hiking nodes cannot be satisfied by cycling-only stats; cross-sport nodes
  require progress across the relevant sports and support multiple prerequisites.
- Every node is inspectable in every state; selection updates the detail panel; unlocking
  occurs only via the explicit CTA; dragging never selects.
- Initial viewport is comfortably readable (core rings framed), with zoom/pan/fit/reset working.
- Existing player Skill-Point balances and unlock history are unaffected (regression).
- No new dependencies, no persisted polar coordinates, no change to economy/unlock/premium/
  Quest semantics.

## Validation

- `npm test` (vitest) — catalog validation, eligibility (including cycling-only regression
  and cross-sport multi-parent gating), layout three-sector split and cross-sport angle,
  page inspectability and initial zoom.
- `npm run build` (tsc) — type checks for the new sport/branch/stat types.
- `test:persistence` (requires `TEST_DATABASE_URL`) — DB-backed `statsQuery` for hiking
  distance/longest, per-sport counts, sport-scoped discovery, elevation aggregation, and
  distinct sport count.
