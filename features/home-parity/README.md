# home-parity

## Goal
Bring the iOS Home screen to data parity with web Home (`public/components/home-page.js`).
Today iOS shows only the level hero and an "Active quests" list; web additionally shows a
NEXT recommendation (or onboarding), Skills & Achievements tiles, and a Recent Activity card.

## Scope
- iOS Home (`ios/Staza/Features/Home/`, small touches in Activities models, `ReplayMapView`,
  `AppShellView`, `Localizable.xcstrings`). All Home endpoints exist and accept the native bearer token.
- Map parity on every iOS map (Home still, activity replay, World): same overlay colors as web
  and completed Flowline segments drawn on activity maps.
- Server: `GET /api/world/basemap` additionally serves the shared overlay `palette`.

## Decisions
- The iOS "Active quests" list is removed (strict web parity); NEXT covers active quests/explorations.
- Recent activity map is a static, non-interactive still of the finished replay (reuses `ReplayMapView`).
- Onboarding card replaces NEXT when the player has no activities.
- Tapping the recent activity opens `ActivityDetailView`; Skills tile and NEXT CTAs switch tabs
  (Skill Atlas / World) or push the quest list.
- Map colors have one source of truth: `src/mapPalette.ts`, served as `palette` with the basemap
  config. Web keeps an identical module (`staza-map-palette.js`) guarded by an equality test, since
  `public/` is served unbundled. iOS falls back to the same values when the palette is missing.

## Implementation plan
1. **Models** — add optional `revisitCount` / `hasVideo` to `ActivityHistoryItem` / `ActivityDetail`.
   New `HomeContent` (progress, lifetime, latest activity detail, optional achievements, quest
   instances) and `HomeNextAction` ported from web `homeNextAction`, priority:
   1. skill points > 0 → "Spend N Skill Point(s)" → Skill Atlas
   2. first authored quest `state == active` → "<title> is active" (body varies on `lastFailure`) → Quests
   3. first quest instance `status == active` → "<title> is active" → World
   4. otherwise "Plan an exploration" → World
2. **HomeModel** loads in parallel: `/api/player/progress-dashboard`, `/api/activities`,
   `/api/quest-instances` (required); then `/api/activities/:id` for the newest activity.
   Secondary and failure-tolerant: `/api/skill-tree`, `/api/player/capabilities`,
   `/api/authored-quests` (empty fallback). Stale content stays visible when a refresh fails.
3. **UI order** — Level hero → NEXT card or onboarding → "Skills & Achievements" (Skills tile with
   unlocked/total, bar and "N SP to spend"; Achievements tile with titles+badges count and first two
   labels; Summary tile with Total XP, Distance, Collected, Flowlines; optional Next quest card) →
   "Recent activity" (date, title, distance, XP earned, static map, detail line
   sport · duration · collected · revisited · Flowlines · POV, up to four collected chips, or empty state).
4. **Static map** — `ReplayMapView` gains a non-interactive mode rendering the end state (full route,
   all reveals) fitted to the route; basemap from `/api/world/basemap`. Hidden if route < 2 points.
5. **Navigation** — `AppShellView` passes tab switching and add-activity callbacks to `HomeView`;
   quests destination pushes `QuestListView`.
6. **Localization** — EN + DE strings mirroring web copy.
7. **Map palette** — `STAZA_MAP_PALETTE` in `src/mapPalette.ts` returned by `getBasemapConfig`;
   web map modules (route, Flowline, collectible, replay, World layers) read the web copy.
8. **iOS map parity** — `MapPalette` decoded from the basemap; `StazaMapLayers` ports the web
   route (glow, casing, line), subdued route and Flowline (casing, completed/uncompleted line) layers.
   - Replay/Home: teal travelled route over a subdued full route, gold position marker, and completed
     Flowline segments (`fartlekGeometry` from `fartlekCompletions`) revealed at their completion time.
   - World: Flowlines colored by `completed`, quest Flowlines highlighted, exploration route gold.

## Acceptance criteria
- iOS Home shows every section of web Home with the same data and next-action priority.
- Home still renders when skill tree / capabilities / authored quests fail to load.
- iOS routes, Flowlines and markers use the web colors on every map; activity maps show completed
  Flowline segments.
- `/api/world/basemap` includes `palette`; web rendering is visually unchanged.

## Validation
- `HomeModelTests`: full load, secondary-source failure tolerance, no detail fetch without
  activities, next-action priority (all four variants, singular SP).
- `ActivityDetailModelTests`: Flowline reveal geometry decoding; basemap palette decoding and fallback.
- `src/basemap.test.ts` (palette served) and `staza-map-palette.test.js` (web copy equals server).
- `xcodebuild test -scheme Staza` (see `ios/README.md`) and `npm test`.
