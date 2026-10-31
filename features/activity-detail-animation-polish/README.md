# Activity Detail Animation Polish

## Goal
Combine the "XP Earned" and "What changed" cards on Activity Detail into one card whose layout never jumps while the replay animates, and make the mobile layout compact so the map stays visible.

## Scope
- `public/components/activity-progress.js`, `activity-outcome.js`, `replay-tab.js`, `public/styles/app-shell.css` and related tests.
- Legacy activities without a frozen `outcome` keep the existing fallback rendering.

## Decisions
- The "COLLECTED" block on the right of XP Earned is removed. The XP total increases dynamically during replay.
- Level row: `Level N` · compact reward chip (collectible/flowline only) · `current / next`. The chip has a reserved, fixed-size slot and fades in/out.
- Distance XP shows no callout: only the progress bar grows, and the distance info (formerly in "What changed") appears as a fixed-height caption inside the card.
- "Level 1 → 2" level-up info becomes part of the progress bar.
- "What changed" content (new collectibles/revisits, Flowlines completed, distance) moves into the merged card. The XP breakdown list is removed.
- Skill-tree CTA: a prominent button, "+N Skill Point(s)" when earned this activity, otherwise "N Skill Point(s) to spend" when unspent points exist; it navigates to the skill tree. The separate "to spend" row and the "Now unlockable" line are removed.
- Quest results (completed/failed) stay in a list below the merged card.
- Mobile: reduced font sizes/paddings so the map is visible. The end-of-replay collection panel overlays the map as on desktop (closable with the existing close button); desktop is unchanged.

## Implementation plan
1. Merge progress and outcome markup, add CTA, remove old rows.
2. Replay wiring: single reward host, skip distance callouts (caption instead), level-up in the bar.
3. Desktop CSS: new card styles, fixed-height rows, compact reward chip, CTA.
4. Mobile CSS: compact card; panel overlays the map (remove static/offset override).
5. Update and add tests.

## Acceptance criteria
- One merged card; no layout shift during replay.
- Reward chip appears between level label and XP counter only for collectibles/flowlines.
- Distance progress only moves the bar and caption.
- CTA links to the skill tree when points are earned or unspent.
- On mobile the map is more visible; the end panel overlays the map.

## Validation
- `npm test` for unit tests (updated `activity-outcome`, `activity-detail-page`, replay tests; new distance-no-callout case).
- `npm run test:e2e` when a database is available.
