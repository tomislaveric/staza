# Home Active Quests

## Goal
Surface the quests a player has committed to on the Home page. Quests are
started as quest instances and are currently only visible on the World page.
Add an "Active Quests" section to Home so players can see their in-progress
quests without leaving Home.

## Scope
- Add an "Active Quests" section to the Home page.
- List only active quest instances (`status === "active"`) returned by the
  existing `GET /api/quest-instances` endpoint (`{ instances: [...] }`).
- When there are no active quests, show an empty state:
  "You don't have any quests active, find some in Staza World", where
  "Staza World" navigates to the World screen.
- No server changes — the `/api/quest-instances` endpoint already exists.

Out of scope: starting or cancelling quests from Home (these remain on World),
completed-quest history on Home, and any changes to the World page.

## Decisions
- **Which quests:** only `status === "active"`.
- **Placement:** after the Recent Activity section (bottom of Home).
- **Card style:** simplified, read-only card showing title, description, and an
  objectives progress bar — no objective drill-down and no cancel button.
- **Empty state:** "Staza World" is a clickable control that navigates to the
  World screen (requires passing a navigate callback into Home).
- **Safety:** user-provided titles/descriptions are escaped (`escapeHtml`) and
  marked `data-user-content`, consistent with existing quest/activity cards.

## Implementation plan
1. **Fetch active quests** (`public/components/home-page.js` → `mountHomePage`):
   add `/api/quest-instances` to the existing `Promise.all` load and derive
   `activeQuests` filtered to `status === "active"`.
2. **View renderers** (`public/components/home-page.js`):
   - `HomeActiveQuestCard(instance)` — simplified read-only card. Compute
     `completed = objectives.filter(o => o.progress.complete).length` and
     `ratio = completed / objectives.length` (mirroring `InstanceCard`), and
     render title, description, a progress track, and a
     "N / M objectives" caption. Reuse existing `quest-card-*` /
     `quest-progress-track` class names where sensible.
   - `HomeActiveQuests(instances)` — section with an "ACTIVE QUESTS" heading;
     renders an `<ol>` of cards, or the empty state with a
     `[data-home-find-quests]` control when empty.
   - Include `HomeActiveQuests` in `HomePage` after `HomeRecentActivity`, with
     `activeQuests` carried on the model assembled in `mountHomePage`.
3. **Empty-state navigation**:
   - Add an `onNavigate` parameter to `mountHomePage`.
   - In `public/app.js`, pass `navigateScreen` into
     `mountHomePage(shell.content, selectActivity, navigateScreen)`.
   - After render, bind `[data-home-find-quests]` to call `onNavigate("world")`.
4. **Styling** (`public/styles/app-shell.css`): add the minimal styles needed
   for the Home quests section and empty-state link if the `quest-*` classes
   (defined in `world.css`) are not applied on the Home screen.
5. **Tests** (`public/components/home-page.test.js`): export the new renderers
   and cover active-quest cards, the empty-state message/control, and active
   filtering.

## Acceptance criteria
- Home shows an "Active Quests" section after Recent Activity.
- With active quests, each renders as a read-only card with escaped title,
  description, and a correct "N / M objectives" progress caption/bar.
- Completed quests do not appear in the Home section.
- With no active quests, the empty-state message renders and the "Staza World"
  control navigates to the World screen.
- Home still loads correctly (progress + recent activity) alongside the new
  section.

## Validation
- Unit tests in `public/components/home-page.test.js` run via `vitest`, covering
  card rendering, the empty state, and active filtering.
