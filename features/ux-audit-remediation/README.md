# ux-audit-remediation

## Goal

Close Staza's game loop and fix the problems found by the October 2026 product
playthrough and UX audit. The loop is:

Activity → GameEvents → XP → Level → Skill Points → Skill Atlas → new goals → next
Activity.

The audit found the pieces in place, but after XP every link is either invisible or
not built. This feature is the backlog of all P0, P1 and P2 findings. Each finding
is fixed on its own, in a separate session.

## Process

- Fix one finding per session. Start each session by reading this README and the
  finding's evidence, then write a focused plan for that finding only.
- Some findings need a product decision first (see each item and *Open product
  decisions*). The session that fixes the finding makes that decision with the user
  and records it here before implementing.
- When a finding is fixed, tick its checkbox and add one line describing the
  resolution. If the work is large enough to deserve its own feature (for example,
  wiring Skill Atlas rewards), create a separate feature with the feature-lifecycle
  workflow and link it from the item.
- Work in priority order (P0 → P1 → P2) unless a dependency says otherwise. Hard
  dependencies are noted per item.

## Scope

In scope: every finding listed below.

Out of scope:
- New features not tied to a finding.
- Strava OAuth and the GoPro video flow, which the audit did not test.

## Findings

### P0: breaks the core loop

- [ ] **P0-1 FIT imports never get a sport.**
  - Problem:
    - `deriveActivity(..., "unknown")` is hardcoded for FIT uploads in
      `src/server.ts` (FIT import and reprocess paths).
    - `src/fit.ts` (`extractFitMetadata`) does not read the FIT sport.
  - Effect:
    - Sport-specific Skill Atlas requirements never progress for FIT users (a
      107 km ride shows "km cycled 0 / 100"; "Sports with activity 0 / 2").
    - The sport is not shown in the UI and cannot be corrected.
    - Activity titles fall back to "Activity", and the detail header reads
      "ACTIVITY COMPLETE".
  - Expected:
    - FIT sport/sub-sport maps to cycling, running or hiking.
    - Unknown values stay `unknown`.
    - The player can see the sport and override it.
    - Skill Atlas stats recompute from the corrected type.
  - Related:
    - `src/skillTree/statsQuery.ts` excludes `unknown` from distinct sports.
    - The Cycling hub uses generic `activityCount`, while Running and Hiking use
      sport-specific counts. Make the hubs consistent.
- [ ] **P0-2 Skill Atlas rewards are not wired to anything.**
  - Problem: only the Atlas reads `skill_tree_unlocks`. The grants are:
    - `quest_unlock` ×43
    - `world_filter` ×5
    - `segment_filter` ×4
    - `title` ×15
    - `badge` ×9
    - `tree_access` ×3

    Quests, World and Profile ignore all of them.
  - Effect: unlocking a node changes nothing, so the loop ends at the Atlas.
  - Expected: every reward type has a visible consumer:
    - Quest unlocks make the matching quest type available.
    - World/segment filters appear in World only once unlocked.
    - Titles and badges show on Profile.

    Reward copy must describe the actual effect. Any reward type that won't be
    implemented is removed from the catalog.
  - Depends on: open decisions 1 and 2. Likely needs its own feature.
- [ ] **P0-3 Import "journey start" is anchored to the first import.**
  - Problem: the first import sets `players.journey_started_at`. Any older activity
    is then rejected with 409 `before_journey_start` ("This activity happened
    before your Staza journey started").
  - Effect: importing a recent ride first permanently blocks backfilling history.
    This hits players who arrive with history, including Strava users. Nothing
    explains the rule beforehand.
  - Expected: a deliberate rule that the player understands. For example, the
    journey start is chosen explicitly or derived from account creation, older
    imports are allowed with defined XP/collection semantics, and the rule is
    explained before the first import. Decide in the session.
  - See `src/errors.ts` and `src/strava/service.ts`.
- [ ] **P0-4 The Skill Point economy doesn't add up.**
  - Problem:
    - Skill Points are awarded at levels 1, 3, 5, 8, 11, 14, 18, 22, 26 and 30,
      then one every four levels. That is 10 SP by L30, which needs 43,500 XP.
    - The 12 free tier-1 nodes cost 12 SP.
    - The full Atlas costs 192 SP.
    - Every tier II+ node (67 nodes) is PRO.
  - Effect: a free player cannot complete the free tier by L30, and after 2–3
    choices every remaining decision is a paywall.
  - Expected: a free player can finish the free tier within a reasonable number of
    activities. The PRO boundary follows the decided monetization line (open
    decision 6).
  - See `src/skillTree/catalog.ts` (award levels, premium-by-tier rule).

### P1: the loop runs but the player can't see it

- [ ] **P1-1 Level-ups and Skill Points are never celebrated.**
  - Problem:
    - The first ride went from L1 to L3 and earned SP, but the result card shows
      only "+550 XP".
    - The replay level bar shows the final level from frame 0.
    - Home never mentions unspent SP; SP appear only on Progress and in the Atlas.
  - Expected:
    - A post-activity "what changed" summary covering level-ups, SP earned, newly
      unlockable nodes, quest progress and completions, and new vs repeat
      discoveries.
    - The replay animates level-ups at the right moment.
    - Home surfaces unspent SP with a link to the Atlas.
- [ ] **P1-2 Quest completion is silent.**
  - Problem:
    - Completion is evaluated lazily on `GET /api/quest-instances`
      (`src/persistence/questInstanceRepository.ts`), not when the activity is
      processed.
    - There is no reward, notification or replay mention.
    - The quest disappears from Home, which reverts to the empty state.
  - Expected:
    - Completion is evaluated during activity processing and shown in the result
      and replay.
    - Completed quests are visible in a history (Progress).
    - The quest reward (open decision 2) is granted, and a next quest is suggested.
- [ ] **P1-3 Quest semantics are undecided.**
  - Problem:
    - The intended design is one-activity quests. The code accumulates progress
      across all activities since the quest started; only the flowline
      `sameActivity` rule is single-activity.
    - The landing page promises "cross-activity" progress and "Bonus XP".
    - The only states are `active` and `completed`. There is no attempted, failed
      or retry state.
  - Expected:
    - One documented semantic, with matching states, UI, landing copy and
      evaluator (`src/questObjectives.ts`).
    - If quests are single-activity: an attempt that misses the objectives is
      marked failed, and the player can retry.
- [ ] **P1-4 Terminology collisions.**
  - Problem:
    - Home (`public/components/home-page.js`) and Activity Detail
      (`public/components/activity-progress.js`) hardcode "Explorer" for every
      level.
    - Progress (`public/components/progress-page.js`) names L5 "Adventurer" and
      both L6 and L7 "Explorer", and has no names after L10.
    - The landing page says ranks start at L5.
    - Atlas nodes reuse "Explorer", "Adventurer" and "Pathfinder".
    - Three sport branches share the label "Explore".
    - The nav says "Skill Tree" (`sidebar.js`, Progress copy) but the page says
      "Skill Atlas".
    - Home says "Quests" but World says "Explorations".
    - "Collected", "Found", "Discovered" and "Visited" are used interchangeably.
    - The Atlas requirement "Places" collides with the "Place" category.
  - Expected:
    - A single glossary (English and German) applied everywhere.
    - One rank table from a single source, or no ranks at all (open decision 4).
    - Rank names that don't collide with node names.
- [ ] **P1-5 Inconsistent collectible counts and repeat XP.**
  - Problem:
    - Home and Activities count collection events (5), while Progress, Profile and
      World count unique collectibles (3) for the same player.
    - Revisiting a collectible grants its XP again (Schloss Karlsruhe +35 twice),
      with no "revisit" label, which invites farming on commutes.
  - Expected:
    - One definition of "collected" everywhere.
    - Revisit semantics decided (open decision 3) and labelled in the result and
      replay.
- [ ] **P1-6 Flowlines are second-class.**
  - Problem:
    - The result card shows "0 collectibles found · +300 XP" with no Flowline
      attribution for the XP.
    - Home, Progress and Profile counters exclude Flowlines.
    - The Flowline card shows raw coordinates.
    - Names leak raw OSM data ("Hayna -> Hayna", "Gochsheim -> ?",
      "B 35;B 293").
    - The replay shows a GPS-noise max speed (99.8 km/h on a bike).
    - Runs get road-cycling Flowlines with km/h stats.
  - Expected:
    - Flowlines count and are attributed wherever rewards are summarized.
    - Readable names, with a fallback when OSM data is incomplete.
    - No raw coordinates.
    - Outlier-filtered speeds.
    - Sport-appropriate Flowlines and units (depends on P0-1).
- [ ] **P1-7 Explore this Area can't deliver a real outing.**
  - Problem:
    - A 50 km round-trip request returned 7.4 and 9.2 km routes, because only the
      frozen viewport's 2 targets were considered.
    - The "round trip" did not visibly return to the start.
    - The flow is ride-only ("Describe your ride"; no sport choice).
    - There is no GPX/device export.
    - The quest card says "Visit 2 other targets" but "0 / 1 objectives".
  - Expected:
    - Route length honours the request: widen the target search or warn when the
      area is too small.
    - Round trips close.
    - The player can choose a sport.
    - The route can be exported as GPX.
    - Objective copy and counts agree.
- [ ] **P1-8 Home doesn't answer "what next?".**
  - Problem:
    - A new player sees a level number and empty cards, with no explanation of
      Staza and no inline import CTA.
    - A returning player isn't pointed to unspent SP, nearby unfound targets or a
      suggested exploration.
  - Expected:
    - First-run onboarding: what Staza is and how to import the first activity.
    - A "next best action" card for returning players: SP to spend, active quest,
      nearby target or suggested exploration.
- [ ] **P1-9 Activities are ordered by import time.**
  - Problem:
    - Lists and Home's "Recent activity" sort by import time, not activity date, so
      "recent" is not the latest activity.
    - Lists have no sport icon and no activity title.
  - Expected: sort by activity start time everywhere, and show the sport and title
    (depends on P0-1).

### P2: polish and consistency

- [ ] **P2-1 The Skill Atlas Skill Points badge is stale after an unlock.** It keeps
  showing the old spent/available values until reload.
- [ ] **P2-2 Skill Atlas copy.**
  - "Cost: 1 Skill Points" (pluralization).
  - "Triple Discipline" says "No progress requirements" although its description
    requires progress in all three sports.
  - "Unlock the connected node first" doesn't name the node.
- [ ] **P2-3 Skill Atlas readability.**
  - All 79 nodes are visible from day one.
  - Labels are unreadable at the default zoom.
  - On mobile the detail panel is below the fold.
  - Consider progressive disclosure: the reachable frontier is emphasized and
    distant tiers are dimmed.
- [ ] **P2-4 World polish.**
  - "Discovered 1 / 10,740" uses a nationwide denominator; use a meaningful scope
    such as the visible area or region.
  - Collectible cards have no actions (distance, route-to, related quest or node).
  - Categories render lowercase ("castle").
- [ ] **P2-5 Onboarding and import polish.**
  - The passkey step after registration has no "later" option.
  - "Process Activity" is enabled with no file selected.
  - Only FIT is accepted; decide on GPX support.
- [ ] **P2-6 Activity Detail polish.**
  - "XP EARNED +0" is shown until the replay animates.
  - The replay map is below the fold.
  - The collectibles panel is titled "Activity · 1/1 completed".
  - Duration rounding differs between screens (5h 19m vs 5h 20m).
- [ ] **P2-7 Progress and Profile roles.**
  - Progress repeats "Level 2 / LEVEL 2", shows only a ±3-level window, and has no
    achievements.
  - Profile's "Explorer record" duplicates Home and Progress.
  - Target split: Home = next action, Progress = trophy room (quests, badges,
    records, per-sport stats), Profile = account.
- [ ] **P2-8 Mobile layout (390 px).**
  - The bottom nav wraps Profile onto a second row.
  - The Add Activity floating button overlaps content.
  - Home's stats grid crowds the "Recent activity" label.

## Open product decisions

Resolve each decision with the user in the session of the finding that depends on
it, then record the answer here.

1. **Skill Atlas role** (P0-2, P0-4): a talent tree, where choices change what you
   can do, or an achievement wall, where requirements are lifetime stats.
2. **Quest source and rewards** (P0-2, P1-2, P1-3): authored/templated quests that
   Atlas nodes can unlock, player-built explorations, or both. Also: what a
   completed quest grants.
3. **Collectible revisits** (P1-5): one-time claim or repeatable XP. If repeatable,
   decide the reduced reward and cooldown.
4. **Ranks** (P1-4): keep one canonical rank table, or remove ranks.
5. **Journey start** (P0-3): how backfilled history is treated.
6. **PRO boundary** (P0-4): gate depth (tier II+) or breadth (cross-sport,
   prestige, extra filters).

## Acceptance criteria

- Every finding above is ticked with a one-line resolution, or explicitly dropped
  with a reason recorded here.
- Every open product decision has a recorded answer.
- Each link of the core, exploration and quest loops is both implemented and
  visible to the player:
  - Activity → XP → Level → SP → Atlas unlock → new content.
  - World target → route → Activity → collection → Progress.
  - Quest start → attempt → result → reward → next quest.

## Validation

- Each finding's session adds focused tests for the behavior it changes and runs
  the smallest relevant test/build command (`npm test`, `npm run build`).
- UI findings are verified in the running app at desktop (1440 px) and mobile
  (390 px) widths.
- After the P0 and P1 items are done, repeat a short playthrough for a new player,
  first activity, Skill Atlas and quest completion to confirm the loop is visible
  end to end.
