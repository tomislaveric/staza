# skill-atlas-mobile

## Goal

Make the Skill Atlas on the native apps show how nodes connect, without porting the
dense radial web map. Today iOS lists every node of a sport as a large card ordered by
row and column. The only hint of dependencies is a "Requires: X" chip, the list is long
(~25 nodes per sport), and the nodes you can unlock next are hard to find. Android only
has a placeholder screen.

## Decisions

- **Presentation:** portrait **branch lanes** per sport (chosen over a full
  pinch/pan radial map, an improved card list, and a radial-overview hybrid).
- **Next up:** add a horizontal strip of `unlockable` nodes across all sports.
- **Header:** keep the existing Skill Point header card unchanged.
- **Platforms:** iOS (SwiftUI) and Android (Jetpack Compose).
- **No server changes.** Positions come from the node structure, as on web. The catalog's
  `layout:{col,row}` is not used for placement.

## Scope

### Lane tree (per sport, chosen with the existing segmented sport picker)
- The sport hub node sits at the top. Below it are **three lanes** in a fixed order:
  - Cycling: FLOW (`rush`) / EXPLORE (`adventure`) / ENDURANCE (`endurance`)
  - Running: SPEED (`speed`) / EXPLORE / ENDURANCE
  - Hiking: SUMMIT (`summit`) / EXPLORE / ENDURANCE
- Each node's row is its progression depth: 1 + the longest in-sport prerequisite path
  from the hub.
- The tree uses a five-column grid: lanes in columns 0, 2, and 4, with gutters in columns 1
  and 3.
- Cross-branch (`cross`), cross-sport (`cross_sport`), and prestige nodes sit at the mean
  column of their in-sport parents, which is often a gutter. If that cell is taken, the
  node tries the neighbouring columns, then moves down one row.
- Nodes with no in-sport prerequisite (reachable only from another sport) share one row
  below the whole tree.

### Connectors
- Curved parent→child connectors are drawn behind the nodes with a canvas, using the
  same meaning as the web `skill-connector` styles:
  - solid accent: both ends unlocked
  - dotted accent: leads to an unlockable node
  - dim: locked or distant
- A node with a prerequisite from another sport shows a small ↗ badge. In its sheet,
  that prerequisite appears as "Requires: Runner · Running". Tapping the chip switches the
  sport and selects that node.

### Nodes
- Compact circles (~44–52pt) in the web style:
  - unlocked: yellow with a check
  - unlockable: glowing ring and a cost chip
  - locked: dimmed
  - premium: crown/PRO badge
- Each node shows a tier glyph (I/II/III/★) and a label of up to two lines.
- Tapping a node opens a **bottom sheet** (medium/large detents) with:
  - grant, description, and cost
  - requirement progress rows and prerequisites
  - the Unlock button
- After an unlock, the sheet stays open and shows the updated state.

### Next up
- A horizontal strip of unlockable nodes appears below the header and is hidden when
  there are none.
- Tapping an entry selects its sport, scrolls to the node, and opens its sheet.

## Implementation plan

### iOS
1. **Lane layout:** `SkillAtlasLaneLayout.swift`, a pure function that turns nodes and a
   sport into positioned nodes (normalized col/row), in-sport edges with style, and
   external references. Add unit tests for depth, cross-node columns, collisions, and
   external references.
2. **Models:**
   - Decode `tier` (an Int or `"prestige"`) and any other required fields from
     `/api/skill-tree`.
   - Add `selectedNodeId`, `nextUpNodes`, and the lane layout to `SkillAtlasModel`.
3. **Lane view:** lane headers, `Canvas` connectors, node glyphs, and scroll-to-node
   support.
4. **Detail sheet:** move the existing node card content (requirement rows,
   prerequisite chips, Unlock) into a sheet, and remove the card list.
5. **Next-up strip.**
6. **Polish:**
   - Accessibility: every node is a button announcing name, state, and cost.
   - Dynamic Type: the tree's own text is capped at the `xLarge` size so three lanes
     still fit; the header, sheet, and Next-up strip scale without a cap. There is no
     horizontal-scroll fallback.
   - Localization in `Localizable.xcstrings`.
   - UI test identifiers.

### Android
7. **Data layer:** Kotlin models and a Compose state holder (`SkillAtlasState`). It
   calls `GET /api/skill-tree` and `POST /api/skill-tree/unlock` through `ApiClient`.
   The app has no ViewModel dependency.
8. **Lane layout:** a Kotlin port of the lane layout, with JVM unit tests.
9. **Screen:** a Compose screen with:
   - the header card, sport tabs, and Next-up row
   - lanes with `Canvas` connectors
   - a `ModalBottomSheet` for node details
   - the screen wired into `TopLevelDestination.SkillAtlas`
   - strings in `values/` and `values-de/`

### Docs
10. Update the iOS and Android README notes on the mobile atlas presentation.

## Acceptance criteria

- Every in-sport prerequisite relationship is drawn as a connector, and its style
  reflects the unlock state.
- Three labelled lanes fit on a 375pt-wide screen without horizontal scrolling at
  default text size.
- Tapping any node opens its details. Unlocking from the sheet updates the tree, the
  header balance, and the Next-up strip.
- Cross-sport prerequisites can be reached from the node sheet's prerequisite chips.
- The Next-up strip lists exactly the `unlockable` nodes.
- Unlock, requirement, premium, and Skill Point semantics behave the same as before.

## Validation

- iOS:
  - unit tests for the lane layout
  - extended `StazaTests/SkillAtlasModelTests.swift`
  - a manual check on iPhone SE width and at large Dynamic Type sizes
- Android: JVM unit tests for the lane layout, and a Gradle build.
