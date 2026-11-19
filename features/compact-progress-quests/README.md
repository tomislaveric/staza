# compact-progress-quests

## Goal

Make quests on the Progress page small, simple and scannable. Show only the
interesting information, using pills instead of prose, modelled on the compact
Finished Quests badges. Bring the iOS app to parity with web: iOS Progress shows
active, locked and finished quests plus badges & titles, and the iOS Quests
screen uses the same compact cards.

## Scope

- Web Progress (`public/components/progress-page.js`, `public/styles/app-shell.css`):
  compact authored-quest cards, pill styles, deduplicated finished-quest display.
- iOS Progress (`ios/Staza/Features/Progress/`): add quests, finished-quest
  badges and badges & titles; remove the quest-history list.
- iOS Quests list (`ios/Staza/Features/More/QuestListView.swift`): compact cards.
- No backend changes. `step`, `totalSteps`, `isNew`, failure criteria
  `current`/`required`/`unit` and `/api/player/capabilities` are already served.
- Out of scope: Home next-quest card, World quest cards.

## Decisions

| Topic | Decision |
|---|---|
| Active card content | Quests read like a to-do list of orders: one row per quest with a checkbox marker, title (+ NEW pill), one-line goal (truncated with ellipsis) and pills: difficulty, `Step x/y`, `+XP`. Rows sit in a single column (no side-by-side cards), so pills never stretch to a neighbour's height |
| Status prose | Remove "Active · your next activity decides" and the explanatory rule paragraph |
| Last failure | One "Fell short" pill plus pills for only the **missed** criteria (e.g. `12/30 km`) |
| Locked quests | Stay in a collapsed group; each is a one-line row with title and a lock pill naming the requirement (Skill Atlas node with PRO marker, or previous quest) |
| Finished quests | FINISHED QUESTS reuses the same task rows as active quests, with a checked (filled yellow) checkbox, dimmed text/pills and a subtler section frame; remove the "N completed" line and the COMPLETED QUESTS history from Progress. Newly finished quests pulse their checkbox and show a NEW pill |
| Pill style | A new `.quest-pill` web style derived from `.quest-badge` / `.new-reward-tag` (capsule, tinted border and fill, small display font); iOS uses existing `StazaChip` in `MoreFlowLayout` |
| iOS quest rows | `QuestTaskRow` inside one `QuestTaskList` card per section/chain (also used for Finished quests); completed quests show a filled accent check and dimmed content; locked quests use the one-line lock row |
| iOS Progress order | Rewards banner, Level, Quests (active + collapsible locked), Finished quests (checked task list), Lifetime, Badges & titles, Milestones, Records, Recent, All activities |
| iOS loading | Authored quests and capabilities load alongside the dashboard; their failure does not break Progress |

## Implementation plan

1. Web markup: add a pill helper; rewrite `AuthoredQuest` / `AuthoredQuests`
   per the decisions; remove `QuestHistory` from `ProgressPage`.
2. Web CSS: add `.quest-pill` variants (accent, danger, muted, lock); tighten
   quest card padding, gaps and type; one-line locked rows; remove unused rules.
3. Web tests: update `public/components/progress-page.test.js`.
4. iOS models: add optional `current`, `required`, `unit` to failure criteria
   and `isNew` to `AuthoredQuest`.
5. iOS components: quest task row and list, and locked quest row.
6. iOS Progress: load authored quests and capabilities in
   `ProgressDashboardModel`; render the new sections in `ProgressView_`; remove
   the history section.
7. iOS Quests list: use the compact card and locked row.
8. Localization keys in `Localizable.xcstrings`; model tests.

## Acceptance criteria

- Web active quest cards show title, one-line goal and pills only; no status
  sentence or rule paragraph.
- Failed attempts show "Fell short" and only missed criteria as pills.
- Locked quests are collapsed one-line rows with a lock pill.
- Finished quests appear once, as checked, dimmed task rows.
- User content stays HTML-escaped.
- iOS Progress shows quests, finished badges and badges & titles consistent with
  web; iOS Quests list uses the same compact cards.
- Progress still renders when quest or capability requests fail.

## Validation

- `npx vitest run public/components/progress-page.test.js`
- iOS: build and run `StazaTests` (Progress and Quest list model tests).
- Visual check of web Progress (desktop and mobile width) and the iOS simulator
  Progress and Quests screens.

## Extension: Home to-do overview

Home shows what the player has to do or can do as a compact checklist that reuses
the Progress task rows (same checkbox, title, one-line goal and pills).

### Decisions

| Topic | Decision |
|---|---|
| Placement | A "TO DO" section replaces the single NEXT action card on Home (web and iOS). New players without activities still see the onboarding card instead |
| Items, in order | 1. Spend Skill Points (when balance > 0; pill `N SP`; opens Skill Atlas). 2. Active authored quests, up to 3 (same content as Progress rows; open Progress on web, Quests on iOS); when more are active, a muted "View all quests (N)" row. 3. Active explorations (title, one-line description, pills `Exploration`, `+XP`; open World). 4. "Plan an exploration" fallback when no quest or exploration is active (opens World) |
| Interaction | Every row is a single tappable button with an unchecked checkbox and a trailing chevron |
| Duplicates | Remove the separate NEXT QUEST card from Skills & Achievements; the to-do list covers it |
| Reuse | Web: shared `public/components/quest-task.js` (pill + task-row helpers) used by Progress and Home. iOS: a generic task row in `QuestCards.swift` used by quest rows and Home to-dos |
| Ownership | The to-do list is assembled on the client from existing endpoints, replacing the existing client-side next-action selection on both platforms |

### Acceptance criteria

- Home shows the TO DO checklist with the items above, each navigating to its target.
- The NEXT action card and NEXT QUEST card are gone; onboarding is unchanged.
- Progress quest rows render identically after the extraction.

## Extension: iOS Quests screen sections

The iOS Quests screen is one list of sections, each a checklist card:

1. **Active quests**: every open quest across all chains.
2. **One section per chain** (e.g. Flow Hunter, Breakaway) that still has locked quests, showing only those locked steps, with the chain's `completed/total` count.
3. **Finished quests (N)**: all completed quests, last, in a collapsed group (like locked quests) of checked, dimmed rows.

On iOS Progress, finished quests use the same collapsed group as locked quests (`Finished quests (N)`), shared as `CollapsibleQuestGroup`.
