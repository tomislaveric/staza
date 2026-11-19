# motivating-home

## Goal
Replace the checkbox to-do list on Home with a motivating overview of what the player can do
next: the easiest open quest, Skill Atlas nodes that can be unlocked right now, and nodes that
are close to being unlockable. Quest lists elsewhere no longer use checkboxes either.

## Scope
- Web Home (`public/components/home-page.js`, `public/styles/app-shell.css`) and the shared quest
  row (`public/components/quest-task.js`, used by Progress).
- iOS Home (`ios/Staza/Features/Home/`) and the shared quest rows (`ios/Staza/Features/More/QuestCards.swift`).
- Android: a real Home screen replaces the Home placeholder (level hero, Up next, Skill Atlas
  highlights). Android has no activity list or quest screen yet, so Recent activity and
  quest navigation are not part of the Android Home.
- No server changes: `/api/skill-tree` already returns per-node `state`, `prerequisitesMet` and
  `requirements[].current/target/met`; `/api/authored-quests` returns quest `difficulty`, `xp`, `state`.

## Decisions
- **Home order:** Level hero → Up next (or onboarding before the first activity) → Skill Atlas
  highlights → Skills & Achievements tiles → Recent activity. The checkbox "To do" list is removed.
- **Up next** is one featured card:
  1. the easiest active authored quest — difficulty `easy` → `medium` → `hard` → `prestige`, then
     lowest XP, then catalog order. Shows chain title, step x/y, title, goal, difficulty, +XP and
     the "fell short" criteria of the last attempt. A footer links to all quests when more are active.
  2. otherwise the first active exploration (title, goal, +XP) → World;
  3. otherwise "Plan an exploration" → World.
  When a quest is featured and an exploration is active, a compact exploration row follows the card.
- **Skill Atlas highlights** (hidden when there is nothing to show and no Skill Points):
  - Header shows the Skill Point balance when > 0.
  - **Ready to unlock:** nodes with state `unlockable`, cheapest first, at most 3; each shows sport,
    name, what it grants and its SP cost.
  - **Almost there:** nodes with state `locked`, prerequisites met and requirement progress > 0,
    ranked by average requirement progress (each capped at 100%), at most 3. Each shows a progress
    bar and its least-complete unmet requirement as `label current/target`; nodes whose
    requirements are all met show "Needs N SP".
  - If Skill Points are available but no node is ready, a "Spend N Skill Points" prompt is shown.
  - Every highlight opens the Skill Atlas; web deep-links to the selected node, iOS and Android
    open the Skill Atlas tab.
  - On Android the featured quest card is informational (no quest screen yet); explorations and
    "Plan an exploration" open the World tab.
- **No checkboxes:** shared quest rows drop the leading checkbox on every platform. Completed quests
  show a "Completed" pill instead.
- Selection logic is pure and mirrored on web (`homeHighlights`), iOS (`HomeHighlights`) and
  Android (`HomeHighlights`) with matching unit tests.

## Implementation plan
1. **Web logic** — `featuredQuest`, `readyNodes`, `almostNodes` in `home-page.js`; Home keeps the
   full skill-tree node list from `/api/skill-tree`.
2. **Web UI** — `HomeUpNext` card and `HomeSkillHighlights` section; remove `homeTodos`/`HomeTodos`;
   drop the checkbox from `TaskRow` and add a Completed pill.
3. **iOS** — `HomeHighlights` in `HomeModels.swift`; `HomeAchievements` keeps skill nodes;
   `UpNextCard` and `SkillHighlightsSection` replace `HomeTodoSection`; `TaskRow` loses its
   checkbox; EN + DE strings.
4. **Android** — `home/` package: models for the progress dashboard, authored quests and quest
   instances; `HomeHighlights` pure logic; `HomeState` loader; `HomeScreen` composable wired into
   `StazaApp` with navigation to the Skill Atlas and World tabs; EN + DE strings. `SkillNode` gains
   `prerequisitesMet`.

## Acceptance criteria
- Home shows no checkboxes; quest rows on Progress / Quests show none either.
- Up next always shows exactly one primary action and picks the easiest active quest.
- Ready to unlock lists only unlockable nodes; Almost there lists only started, locked nodes whose
  prerequisites are met, ranked by progress.
- Home still renders when the skill tree or authored quests fail to load (highlights hidden).
- The same inputs produce the same selections on web, iOS and Android.

## Validation
- Web: `npx vitest run public/components/home-page.test.js public/components/progress-page.test.js`.
- iOS: `HomeModelTests` cover quest and node selection.
- Android: `HomeHighlightsTest`; `./gradlew :app:testDebugUnitTest`.
