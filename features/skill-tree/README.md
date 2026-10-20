# Skill Tree

Interactive, animated progression tree where the player spends **Skill Points** to
actively unlock nodes. Unlocking is explicit, server-enforced, idempotent, and
persistent. Nodes have **requirements** (derived from existing durable progress)
that gate eligibility and a **cost** in Skill Points. Unlocked nodes grant bounded
*content / capability access* (badges/titles, quest / quest-chain unlocks, World /
segment filters, access to deeper nodes) — **not** a generic gameplay-bonus rules
engine.

> The detailed design intent (in German) lives in `features/skilltree/README.md`
> and is the source of the decisions recorded here. That notes directory is kept
> as-is; this document is the durable, approved implementation plan.

## Goal

Add a new first-class **Skill Tree** screen (`/en/skill-tree`, `/de/skillbaum`)
with its own navigation entry. The player earns Skill Points primarily from player
levels, and spends them to specialize along sport-specific branches. Progress
stats (distance, Flowlines, Places, etc.) are **requirements**, never consumed by
unlocking.

```text
Activities → XP / Level → Skill Points (currency)
Activities → durable progress stats → node requirements (eligibility)
Skill Points + requirements + prerequisites → explicit, persistent unlock → capability grant
```

## Decisions

Confirmed with the user (incorporating the German design notes):

- **Nature:** Interactive. Nodes are actively unlocked by spending Skill Points,
  not auto-unlocked. No large generic gameplay-bonus rules engine in this version.
- **Skill Points are global** (not per-sport) and **earned primarily from player
  levels**. They are scarce enough to force real choices. Not purchasable; no
  paid Skill Points, XP boosters, or requirement shortcuts.
- **Skill Point curve** (≈10 SP by level 30): awarded at levels
  1, 3, 5, 8, 11, 14, 18, 22, 26, 30 (+1 each), widening afterward. Defined as a
  versioned table in code.
- **Earned points are derived deterministically** from durable progress (the level
  curve). **Spent points are persisted** as the set of unlocked nodes. Balance =
  `earnedPoints − Σ(cost of unlocked nodes)`; nothing is a mutable counter, so
  replays/reconnects can never double-spend.
- **Node costs by tier:** Tier 1 = 1 SP, Tier 2 = 1–2 SP, Tier 3 = ~2 SP,
  Prestige / Cross-Sport = 2–3 SP.
- **Requirements** are concrete, multi-activity progress values shown as
  `current / target` (e.g. `12 / 20 Flowlines`, `860 / 1000 km`,
  `Longest Ride 82 / 100 km`). Requirement types: XP / level, total distance,
  cycling distance, running distance, Flowlines (unique), Places, Mountain Passes,
  Viewpoints and other collectible categories (unique discoveries), activity count,
  longest ride, longest run, elevation, prerequisite nodes unlocked.
- **Premium gating is in scope.** Tier 1 is fully free: free users can see and
  unlock all Tier-1 nodes, earn Skill Points, and accumulate progress. Tier 2+
  (incl. Cross-Branch, Prestige, Cross-Sport) are **visible** to free users with
  requirements and rewards shown, but **unlock is Premium-only**. Premium gates
  access to deeper progression, never the underlying historical progress or earned
  Skill Points. Enforced server-side. (No billing/checkout is built here; a
  single server-side premium flag on the player governs the boundary, defaulting
  to the existing single local player as premium-enabled for development.)
- **Quests and Skill Nodes are separate systems.** A node is unlocked only by
  requirements + Skill Points; a quest is never required to unlock a node. Nodes
  may *grant* quest/quest-chain unlocks, which are then completed independently.
  Skill-tree progress accumulates across many activities; quests remain concrete
  one-ride challenges.
- **No XP multipliers** and **no respec** in this version, but the data model must
  allow respec later (unlocks are an append-only, individually-removable set).
- **Multi-sport ready:** the tree is structured by sport branches with shared
  play-style zones and later cross-sport nodes. v1 ships the **Cycling** tree
  fully; Running and cross-sport nodes are defined in the catalog structure but
  may remain Premium/placeholder.
- **Visual:** dependency-free animated SVG node-and-branch tree reusing existing
  design tokens; reduced-motion respected.
- **Menu label:** "Skill Tree".

### Initial Cycling tree (catalog v1)

```text
Root:  Cyclist
Rush:       Rusher I → Rusher II → Flow Hunter → Flow Specialist
Adventure:  Adventurer I → Pathfinder → Explorer → World Seeker
Endurance:  Endurance I → Distance Rider → Fondo → Ultra Rider
Cross-Branch:
  Breakaway Specialist   (requires Rush + Endurance progress)
  Grand Explorer         (requires Adventure + Endurance progress)
  All-Rounder            (requires progress in all three branches)
```

Example node rewards: Rusher II → High Flow map filter; Pathfinder →
Undiscovered Only filter; Fondo → Fondo Quest Chain; Endurance II → Long Endurance
Segment filter; Breakaway Specialist → Flow + Distance challenges; All-Rounder →
Mixed Quest Chain. Tier 1 introduces first quest categories/filters; Tier 2/3 add
specialized chains and better filters; Prestige adds status, rare chains, titles.

## Data model

New migration `03x_skill_tree`:

- `skill_tree_unlocks (player_id UUID FK → players ON DELETE CASCADE,
  node_id TEXT, unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cost INTEGER NOT NULL CHECK (cost >= 0), PRIMARY KEY (player_id, node_id))`
  — append-only record of player choices; cascade matches migration 022.
- Player premium flag: add `is_premium BOOLEAN NOT NULL DEFAULT false` to
  `players` (same migration), defaulting the development/local player to premium
  via the migration or player bootstrap so the boundary is testable.
- The **node catalog** (node_id, branch, tier, cost, requirements, prerequisites,
  grant, premium flag) is a **versioned static definition in code**
  (`src/skillTree/catalog.ts`), like collectible/quest templates — not a table.
  The DB stores only player choices.

## Implementation plan

### Backend
- `src/skillTree/catalog.ts` — node / branch / tier definitions, Skill-Point
  award curve, and catalog validation (no dangling prerequisites, costs ≥ 0, valid
  grants) in the existing config-validation style.
- `src/skillTree/eligibility.ts` — pure functions: `earnedPoints(stats)`,
  `isEligible(node, stats, unlockedSet, isPremium)`, `balance(earned, unlocked)`,
  and per-requirement `current/target` evaluation for display. No DB access.
- `src/persistence/activityRepository.ts` — add `getSkillTreeStats(playerId)`
  aggregate: total + sport-split distance, longest ride, longest run, activity
  count, elevation, unique discoveries per collectible category, unique Flowline
  completions, quest completions.
- `src/persistence/skillTreeRepository.ts` — `getUnlockedNodeIds(playerId)` and
  transactional idempotent `unlockNode(playerId, nodeId)`: lock player row,
  recompute stats + earned points, re-check premium + eligibility + affordability
  + prerequisites, `INSERT ... ON CONFLICT DO NOTHING`, return updated tree state.
- `getUnlockedCapabilities(playerId)` helper so downstream consumers (World
  filters, quest availability, Profile badges/titles) read granted capabilities
  from one place.
- `src/server.ts` endpoints (behind `requirePlayer`; CSRF on mutations):
  - `GET /api/skill-tree` → nodes with per-node state
    (`locked` / `unlockable` / `unlocked` / `premium_locked`), per-requirement
    `current/target`, earned points, spent, balance, `isPremium`, stats snapshot.
  - `POST /api/skill-tree/unlock` `{ nodeId }` → `201` newly unlocked,
    `200` already unlocked (idempotent), `409` with `code`
    (`insufficient_points`, `requirement_not_met`, `prerequisite_locked`,
    `premium_required`, `unknown_node`).

### Frontend
- `public/components/skill-tree-page.js` — view-model + animated SVG renderer:
  branches laid out as columns, animated connectors, node states with glow on
  unlockable nodes and an unlock pulse, premium-locked styling with requirements
  still shown, a Skill-Point balance header, and a node detail panel with a
  requirement checklist (`current/target` + progress bars) and an **Unlock**
  button (disabled unless eligible, affordable, and unlockable). Confirms
  optimistic state against the server response and re-fetches on success.
- `public/components/skill-tree-page.css` (or extend `app-shell.css`) — styling
  from `design-tokens.css`; keyframe animations for connectors and unlock pulse;
  `prefers-reduced-motion` honored.
- Nav: add `["skill-tree", "Skill Tree", "nav-skill-tree.svg"]` to `navItems` in
  `sidebar.js` (desktop + mobile) and a `public/assets/nav-skill-tree.svg` icon.
- Routing: register `skill-tree` in `appRoutes` (`en: skill-tree`,
  `de: skillbaum`) in `app-locales.js`; wire `mountSkillTreePage` into `app.js`
  `showScreen`.
- Localization: add all new UI strings (and node names/descriptions) to the
  `germanCopy` map.

### Capability wiring (bounded, first version)
- Fully wire **badge/title** grants end-to-end (surfaced on Profile + Skill Tree)
  and **tree_access** depth gating.
- Expose `world_filter` / `segment_filter` / `quest_unlock` grants through
  `getUnlockedCapabilities`; consumer wiring in World/quests may be stubbed behind
  that helper for a later feature, without a generic rules engine.

## Acceptance criteria

- A new Skill Tree nav entry routes to an animated SVG tree at
  `/en/skill-tree` and `/de/skillbaum`.
- Earned Skill Points match the level curve; balance = earned − spent and can
  never go negative or be double-spent (idempotent unlock verified under repeat
  calls).
- Unlocking is rejected server-side when requirements, Skill Points, prerequisites,
  or premium gating are not satisfied, each with a specific error `code`.
- Tier-1 nodes are unlockable by free players; Tier-2+ are visible but
  premium-locked for free players.
- Node requirements display as `current / target` from real durable stats.
- At least one capability grant (badge/title) is surfaced end-to-end; other grants
  are readable via `getUnlockedCapabilities`.
- Existing XP/progression math is unchanged; Skill Points are an additive layer.
- All new UI strings are localized in English and German.

## Validation

- `src/skillTree/eligibility.test.ts` — earned points, balance, eligibility edge
  cases (exact threshold, missing prerequisite, insufficient points, premium
  boundary).
- `src/skillTree/catalog.test.ts` — catalog validation (no dangling prerequisites,
  costs ≥ 0, grants valid, premium tiers consistent).
- `src/persistence/skillTreeRepository.test.ts` (persistence suite) — idempotent
  unlock, no double-spend on repeat/concurrent unlock, prerequisite/premium
  enforcement, cascade delete with player.
- `public/components/skill-tree-page.test.js` — view-model state derivation and
  render (locked / unlockable / unlocked / premium-locked).
- `npm run build` and targeted `vitest` runs for the new suites.
