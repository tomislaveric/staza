# ios-figma-redesign


## Goal
The SwiftUI app (`ios/Staza`) works but looks plain: mostly default `List` and `StazaCard` styling, a light palette that doesn't match the web, and no shared component library. The web app design lives in the Figma file `FBH108ct3ahbU7xXiSwdba`, with pages for Home, Rides, Ride Detail, World, Add Activity, Progress, Auth, Profile, Brand and Landing. It has a dark canvas, a yellow accent (#F5C823), big numeric hero stats, mono metric rows and rarity-coloured chips.

## Decisions (confirmed)
- **Redesign:** design a native iOS UX rather than restyling the current layout. Each SwiftUI view still gets exactly one Figma frame.
- **Dark mode only**, matching the web.
- **SF Pro typography** (SF Pro, SF Pro Rounded, SF Mono for metrics). Brand identity comes from colour, layout and the logo mark, not fonts.
- **Apple iOS and iPadOS 26 (Liquid Glass) UI kit** for the chrome: status bar, nav bar, tab bar, sheets, buttons, list rows and the Product Bezel for iPhone 16 Pro (402×874). This requires accepting Apple's EULA in Figma first.
- **Location:** new `iOS / …` pages in the same Staza Figma file.
- **States:** design loading, empty and error states per screen as variants or extra frames.
- **Implementation:** after the designs are signed off, update the SwiftUI code to match.

## Screen inventory (one Figma frame per SwiftUI view)
| # | SwiftUI view | Web reference page | Extra states |
|---|---|---|---|
| 1 | AuthView | Auth Desktop | passkey in progress, error |
| 2 | AppShellView (TabView: Home, World, Skill Atlas, Progress, More, plus the Add action) | Home Desktop sidebar | — |
| 3 | HomeView | Home Desktop | loading, failed, empty (no rides) |
| 4 | WorldView + WorldMapView | World Desktop | — |
| 5 | WorldDetailSheet (sheet) | World Desktop detail | — |
| 6 | ExplorePanel | World Desktop explore | idle, loading |
| 7 | SkillAtlasView | (web skill tree) | loading, failed |
| 8 | ProgressView_ | Progress Desktop | loading, failed |
| 9 | ActivitiesView | Rides Desktop | loading, failed, empty |
| 10 | ActivityDetailView | Ride Detail Desktop | loading, failed |
| 11 | ReplayView + ReplayMapView + ReplayTimeline | Ride Detail replay | playing, paused |
| 12 | AddActivityView (sheet) | Add Activity Desktop | idle, uploading, failed, success |
| 13 | StravaImportView | Add Activity / import | loading, error, empty |
| 14 | MoreView | Profile Desktop nav | signed in, signed out |
| 15 | ProfileView (+ step-up and export sheets) | Profile Desktop | loading, export sheet |
| 16 | QuestListView | Home quests | loading, empty |
| 17 | Settings (currently a PlaceholderScreen) | — | — |

## Scope change (Figma MCP limit)
Figma work stopped partway because the Starter plan's MCP tool-call limit was reached. The user chose to skip the rest of the Figma work and implement the redesign directly in SwiftUI.

**Done in Figma:** on the `iOS APP` page (Starter plan has a 3-page limit, so it is organised with Sections instead of separate pages):
- The `Staza iOS / Primitives`, `Staza iOS / Color` (Dark) and `Staza iOS / Layout` variable collections.
- 17 SF Pro text styles.
- The Foundations doc.
- The Button, Chip, Progress Bar and Section Header components.

**Not done:** the other components and the per-screen frames. The Figma tokens are the source of truth for `Tokens.swift`, and each SwiftUI screen is redesigned directly in code using the shared components.

## Implementation plan

### Phase A: Figma foundations (page `iOS / Foundations`)
1. Prerequisite: the user accepts Apple's iOS 26 UI kit EULA in Figma. Confirm the library is searchable.
2. Create a `Staza iOS` variable collection (dark mode only) seeded from `StazaColor` and the web `design-tokens.css`: canvas, surface, surfaceRaised, textPrimary, textMuted, accent, onAccent, success, border and the rarity colours. Set explicit scopes on every variable.
3. Add spacing and radius variables mirroring `StazaSpacing` and `StazaRadius`.
4. Create text styles mapped to iOS Dynamic Type: Large Title, Title 1–3, Headline, Body, Callout, Subheadline, Footnote, Caption, plus Metric (SF Mono) and Hero Number (SF Pro Rounded, heavy).

### Phase B: Figma component library (page `iOS / Components`)
Build custom components from tokens. Use Apple kit components for the system chrome instead of rebuilding them.
- StazaCard (default, highlighted)
- StatTile (hero XP/level, small stat)
- MetricRow (mono)
- XP progress bar
- RideCard (with route sparkline)
- TargetCard (rarity variants)
- CollectibleChip (rarity × category)
- QuestRow (progress)
- PrimaryButton and SecondaryButton (default, pressed, disabled, loading)
- SectionHeader (title plus trailing link)
- EmptyState, ErrorState and LoadingSkeleton
- MapOverlayControls (glass)
- ReplayTimeline scrubber
- Logo mark
Take a screenshot to review the library before moving on.

### Phase C: Figma screens (one page per area: `iOS / Auth`, `iOS / Home`, `iOS / World`, `iOS / Skill Atlas`, `iOS / Progress`, `iOS / Activities`, `iOS / Add Activity`, `iOS / More`)
- Each frame is 402×874 inside a Product Bezel, built with auto-layout and instances only, with the Apple status bar, nav bar and tab bar.
- Build one screen at a time, take a screenshot and check it against the web reference before the next.
- Put state frames next to the primary frame, named `<View> / <State>`.
- Add annotations for accessibility identifiers that the e2e/UI tests rely on, such as `addActivityButton` and `profileLink`.

### Phase D: design sign-off
Share frame links and screenshots for review. Iterate on feedback before writing any code.

### Phase E: SwiftUI implementation
1. Update `DesignSystem/Tokens.swift` to the final Figma tokens. Since the app is dark only, add `.preferredColorScheme(.dark)` at the root and add the rarity colours.
2. Extend `DesignSystem/Components.swift` with the Swift counterparts of the Phase B components. Add `#Preview`s for each.
3. Restyle each feature view to match its frame, screen by screen, keeping the models and behaviour unchanged.
4. Update the shell: tab bar tint, nav bar appearance and the Add Activity action.
5. Validate:
   - `xcodebuild` build and the `StazaTests` unit tests still pass.
   - Accessibility identifiers are preserved.
   - Spot-check screenshots in the simulator against the Figma frames.
6. Optionally add Code Connect mappings for the custom components.

## Notes / risks
- If the Apple EULA isn't accepted, the kit components can't be used. In that case I will stop and ask rather than hand-roll the chrome.
- The map screens (World, Replay) use MapLibre at runtime. In Figma they get a static map image or placeholder with glass overlays.
- The current Settings screen is a placeholder, so its frame is a lightweight design proposal.
- The redesign may introduce layout that needs data the models already have. No backend or API changes are in scope; any new data needs are flagged rather than built.

## Acceptance criteria
- The Staza Figma file's `iOS APP` page holds:
  - the dark-mode `Staza iOS` variable collections and SF Pro text styles;
  - the Foundations doc;
  - the Button, Chip, Progress Bar and Section Header components.
- Per-screen Figma frames are out of scope (see "Scope change" above).
- `ios/Staza/DesignSystem/Tokens.swift` mirrors the Figma variables 1:1, and the app is dark only.
  - This replaces the light/dark support from *iOS app foundations and shell*.
- `ios/Staza/DesignSystem/Components.swift` provides the shared components:
  - card;
  - capsule button styles;
  - section header, overline, hero number, stat tile, progress bar, chip, icon badge and metric line;
  - loading, empty and error state views;
  - glass panel.
- Every feature screen uses these components and has a designed loading, empty and error state where applicable.
- Models, behaviour, navigation and accessibility identifiers are unchanged.
- English and German strings exist for every new localized key.

## Validation
- `xcodebuild` builds the Staza scheme and the `StazaTests` unit tests pass.
- SwiftUI previews compile in dark mode.
- Spot-check screens in the simulator.
