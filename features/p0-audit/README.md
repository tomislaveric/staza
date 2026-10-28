# p0-audit

## Goal

Fix the four P0 findings from the October 2026 UX audit so activity imports,
progression, Skill Atlas choices, and newly unlocked content form a working,
visible core loop.

## Scope

In scope:

- P0-1: FIT sport mapping, sport correction, and consistent sport-specific
  progression statistics.
- P0-2: visible, effective consumers for Skill Atlas grants.
- P0-3: a clear, consistent journey-start import boundary.
- P0-4: a sustainable Skill Point economy and breadth-focused PRO boundary.

Out of scope: all P1/P2 audit findings and features not required to close these
four findings.

This groups the four findings into one feature at the user's request, overriding
the audit backlog's default of one finding per session.

## Decisions

- **Atlas role:** a talent tree whose choices unlock capabilities and content.
- **Quest unlocks:** `quest_unlock` grants unlock authored quest templates or
  chains, with availability enforced server-side. Locked content may be visible
  but must identify the Atlas node required to unlock it.
- **Quest completion:** grant XP and progress the authored chain to its next
  quest. Milestone/prestige quests may grant a badge or title. Normal quests do
  not grant Skill Points and do not auto-unlock Atlas nodes. Player-built
  explorations are not the primary consumer of `quest_unlock`.
- **Journey start:** use account creation as the boundary. Reject activities
  dated before account creation, consistently across FIT and Strava imports, and
  explain before the first import that only activities on or after account
  creation are eligible.
- **PRO boundary:** prioritize breadth and advanced content, not universal tier
  depth. Keep the athlete root, sport hubs, core Cycling/Running/Hiking branches,
  core progression through several tiers, meaningful specialization choices,
  basic authored quests and filters, and core titles/badges free. PRO may gate
  cross-sport and hybrid nodes, prestige/late-game progression, advanced quest
  chains and filters, premium cosmetics/status rewards, and future advanced
  progression. Tier II is not universally PRO.

## Implementation plan

1. Map FIT sport and sub-sport metadata to cycling, running, or hiking; preserve
   `unknown` for unrecognized values. Apply mapping to both FIT import paths,
   expose an activity sport correction, recompute Atlas statistics when it
   changes, and make hub counts consistent.
2. Wire every Skill Atlas grant type to a visible effect. Implement authored
   quest unlocks, server-side availability checks, World/segment filters, and
   Profile title/badge presentation. Make grant copy describe actual effects;
   remove any catalog grants that will not be supported.
3. Derive journey start from account creation, enforce the same pre-account
   rejection for FIT and Strava imports, and explain the rule in the import flow.
4. Rebalance Skill Point award levels and premium eligibility against the
   breadth-focused PRO boundary. Ensure free players can make meaningful
   specialization choices and complete the free core tier in a reasonable
   number of activities.
5. Add focused regression tests for each behavior, run relevant tests and the
   build, smoke-check impacted desktop/mobile flows, and record a one-line
   resolution for each P0 in `features/ux-audit-remediation/README.md`.

## Acceptance criteria

- FIT sport/sub-sport maps to cycling, running, or hiking; unsupported values
  remain unknown. Players can correct sport and see the corrected type reflected
  in titles, detail UI, and Atlas statistics.
- Every remaining Skill Atlas reward has a visible consumer. Quest unlocks are
  enforced server-side and clearly identify the required node while locked.
- Pre-account activities are rejected by every import path with a clear
  explanation; the boundary is communicated before the first import.
- Free Skill Point awards and access support meaningful core specialization;
  PRO gates breadth/advanced content rather than all Tier II nodes.
- All four P0 items in the audit README are checked off with one-line
  resolutions, and focused regression tests cover the changed behavior.

## Validation

- Run focused Vitest selectors for FIT parsing/import, activity correction and
  statistics, skill-tree grants/eligibility, journey-start rejection, and quest
  availability; run `npm run build`.
- Smoke-check import, sport correction, Atlas unlocks and consumers, and the
  free/PRO boundary at desktop (1440 px) and mobile (390 px).
- Repeat a short first-activity and Atlas/quest progression playthrough to
  verify the core loop is visible end to end.
