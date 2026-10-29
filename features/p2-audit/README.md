# p2-audit

## Goal

Resolve all eight P2 findings (P2-1 to P2-8) from the October 2026 product
playthrough and UX audit in one coordinated batch, as done for p0-audit and
p1-audit. Each finding is ticked with a one-line resolution in
[UX audit remediation](../ux-audit-remediation/README.md).

## Scope

In scope: P2-1 through P2-8 in the UX audit remediation README.

Out of scope: P0/P1 rework, new features not tied to a finding, Strava OAuth,
the GoPro video flow, and Figma work. Resolved P0/P1 behavior is preserved.

## Decisions

- All eight P2 findings are delivered in one batch.
- **Import (P2-5):** GPX is accepted in addition to FIT. Sport kind is mandatory
  at import: the sport dropdown has no "unknown" option, is prefilled when the
  file declares a sport, and otherwise the player must choose. The server rejects
  a missing or invalid sport. The activity-detail sport override also drops
  "unknown". Strava imports keep deriving sport from the Strava type.
- **Skill Atlas readability (P2-3):** progressive disclosure. The reachable
  frontier is emphasized, distant tiers are dimmed, labels are readable at the
  default zoom, and on mobile the detail panel is a bottom sheet.
- **World (P2-4):** the "Discovered X / Y" denominator is the visible map area.
- **Progress and Profile (P2-7):** Progress becomes a trophy room answering "Show
  me what I have accomplished", built only from existing persisted data. No second
  progression currency or achievement engine. Profile is account-only. Home stays
  the "next action" surface.

## Implementation plan

1. **P2-1:** refresh the Skill Points badge (spent/available) after an unlock
   without a reload.
2. **P2-2:** pluralize cost ("1 Skill Point"); fix the "Triple Discipline"
   requirement text; name the node in "Unlock the connected node first" (English
   and German).
3. **P2-3:** frontier emphasis and dimming of distant tiers, legible labels at
   default zoom, mobile bottom-sheet detail panel.
4. **P2-4:** visible-area discovered denominator; collectible card actions
   (distance, route-to, related quest or node); properly capitalized, localized
   category labels.
5. **P2-5 (UI):** passkey step gets a "Later" option; "Process Activity" stays
   disabled until a file and a sport are chosen; accept `.fit` and `.gpx`;
   mandatory sport dropdown.
6. **P2-5 (backend):** GPX parser producing track points and metadata; import and
   job paths accept GPX; validated required `sport` field; Atlas stats recompute
   reused. GPX `<type>` is only a prefill hint.
7. **P2-6:** no "XP EARNED +0" before the replay animates; replay map above the
   fold; fix the "Activity · 1/1 completed" collectibles panel title; one
   duration formatter on all screens.
8. **P2-7:** Progress shows unlocked badges and titles, completed quests and
   quest chains, personal records (longest ride/run/hike, highest elevation gain
   where reliable), per-sport lifetime distance, discovery milestones (unique
   Flowlines, Places, Peaks, Mountain Passes). It does not duplicate Atlas
   unlock decisions, current quest objectives, or generic profile info. Remove
   the repeated "Level 2 / LEVEL 2" and the ±3 level window. Profile drops the
   "Explorer record" duplication.
9. **P2-8:** at 390 px, single-row bottom nav, Add Activity button not
   overlapping content, Home stats grid spacing.

## Dependencies and constraints

- P2-5 backend follows the P2-5 UI so the `sport` field name is settled.
- P2-1, P2-2, P2-3 and P2-8 are independent. P2-7 verifies available data first.
- Do not add unrelated features.

## Acceptance criteria

- All eight P2 findings are fixed and ticked with one-line resolutions.
- GPX and FIT imports both require a valid sport; invalid or missing sport is
  rejected by the server.
- Progress contains only accomplishment/history content from existing data.
- English and German copy are updated together.

## Validation

- Focused tests for each changed behavior (GPX parsing, sport validation,
  Atlas copy/badge, Progress aggregation, UI components).
- `npm test` and `npm run build`.
- UI verified in the running app at 1440 px and 390 px widths.
