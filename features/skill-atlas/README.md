# skill-atlas

Refactor the existing Staza Skill Tree visualization into a pannable, zoomable,
radial **Skill Atlas**. This is a visual/layout/interaction refactor only — all
gameplay behavior, persistence, requirements, Skill-Point spending, premium
gating, APIs, and server-side rules remain unchanged.

## Goal

Replace the current top-down SVG skill graph with a premium progression
**atlas / constellation map** that is pannable, zoomable, radial, and ready to
expand to multiple sports over time, without introducing a new frontend
framework, replacing SVG, using MapLibre, or adding dependencies.

## Scope

In scope (client-only, visual/layout/interaction):

- Radial concentric-ring layout derived client-side from the structure the
  server already sends (`sport`, `branch`, `tier`, `prerequisites`).
- Controlled atlas viewport: drag-pan, wheel zoom (pointer-centered), pinch
  zoom, clamped min/max zoom, and small unobtrusive controls (zoom in/out,
  reset-center, fit). Double-click/select focuses a node.
- Premium dark visual language: gold progression accent, understandable node
  states, refined PRO indication, progression connectors with restrained
  unlock animation.
- Preserved detail panel behavior and stable page structure (nav, header,
  Skill-Point card, detail panel all fixed outside the viewport).
- Architecture separation: domain data vs. layout calculation vs. viewport
  state vs. SVG rendering vs. selection/detail state.
- Visual readiness for future sports (Running, Hiking) and cross-branch /
  cross-sport connectors — **without inventing gameplay data**.

Out of scope / non-goals: changing the Skill-Point economy, requirements,
unlocked nodes, or premium rules; new sports gameplay; Running/Hiking
extraction; a generic bonus engine; Quest semantics; replacing SVG with Canvas;
MapLibre; physics/random layouts; new dependencies; any server/domain model or
persistence change.

## Decisions

- **Ring 0 root:** a client-only synthetic neutral **"Athlete"** node. No
  domain or persistence change.
- **Cycling sport node:** the existing real `cyclist` node becomes the Ring 1
  sport node, **label unchanged ("Cyclist")**, still selectable and unlockable.
- **Radial model:** deterministic concentric rings.
  - Ring (radius) = progression depth = longest prerequisite path from the root
    (Ring 0 root, Ring 1 sport, Ring 2 Tier-1, Ring 3 Tier-2, Ring 4 Tier-3,
    outer rings for prestige). Same progression depth → same ring where
    practical. Tier is a tiebreak.
  - Angle = sport sector + branch sector. Cycling fills the circle now; future
    sports take adjacent sectors. `rush / adventure / endurance` get fixed
    sub-sector angles; chains fan outward.
  - Cross-branch nodes sit on the outer ring matching their depth, at the mean
    angle **between** contributing branch sectors. Future cross-sport nodes sit
    between contributing sport sectors.
  - Polar coordinates are never persisted. The catalog `layout:{col,row}` stays
    for backwards compatibility but is **ignored** by the radial renderer.
- **Viewport controls:** zoom in, zoom out, reset/center, and **fit**.
- **Focus on node:** double-click / selecting a node smoothly recenters it
  (disabled under reduced motion).
- **Sport identity:** secondary accents only via a small extensible visual
  config (cycling cool/cyan, running warm/coral, hiking natural/green as future
  placeholders). Gold remains the universal progression/unlock color. Green is
  reserved for success/completion feedback.

## Implementation plan

Client modules under `public/components/`, orchestrated by a slimmed
`skill-tree-page.js`:

1. **`skill-atlas-visual-config.js`** (new) — extensible config: sport accents,
   ring radii, node sizes. No hardcoded sport colors scattered through render.
2. **`skill-atlas-layout.js`** (new) — pure deterministic radial layout. Injects
   the synthetic Athlete root; computes ring = prerequisite depth, angle =
   sport sector + branch sector; places cross nodes between sectors; outputs
   positioned nodes (`{x, y, ring, angle}`) and connectors. Ignores catalog
   col/row; no randomness; reproducible ordering.
3. **`skill-atlas-render.js`** (new) — radial SVG rendering: node glyphs (icon,
   tier badge, small PRO chip, label), curved parent→child connectors, and
   sport/branch sector labels (Flow / Explore / Distance). Consumes layout +
   visual config. Sport nodes larger than skill nodes; root is the strongest
   (not oversized) landmark.
4. **`skill-atlas-viewport.js`** (new) — pan/zoom controller: inner `<g>`
   transform (translate + scale); pointer drag-pan with capture; wheel zoom
   centered on pointer (`passive:false`, `preventDefault`); two-pointer pinch;
   clamped min/max; controls (zoom in/out, reset, fit); animated focus-on-node;
   reduced-motion aware. Keeps page scroll separate from atlas pan.
5. **`skill-tree-page.js`** (refactor) — orchestration: fetch, selection/detail
   state, header, preserved `SkillNodeDetail` panel, unlock POST, mounting the
   viewport + render + controls, keyboard (Enter/Space) selection, double-click
   focus. Removes the old col/row geometry and top-down graph.
6. **`public/styles/skill-tree.css`** (update) — fixed-size viewport, unobtrusive
   controls, radial nodes/connectors, near-black backdrop with subtle depth
   (not a literal map), gold progression states (unlocked / unlockable / locked
   / premium), subtle sport accents, connector progression animation, responsive
   stacking, and `prefers-reduced-motion` handling.
7. Tests: update `public/components/skill-tree-page.test.js` to the radial
   model and add `public/components/skill-atlas-layout.test.js` for deterministic
   ring/sector/depth math.

Unchanged: all `src/skillTree/**` and persistence/server code, `public/app.js`,
and `public/index.html` (CSS already linked; new JS is import-chained).

## Node → ring mapping (from the existing Cycling catalog)

- Ring 0: Athlete (synthetic)
- Ring 1: `cyclist`
- Ring 2: `rusher-i`, `adventurer-i`, `endurance-i`
- Ring 3: `rusher-ii`, `pathfinder`, `distance-rider`
- Ring 4: `flow-hunter`, `explorer`, `fondo`, and cross nodes
  `breakaway-specialist`, `grand-explorer` (between sectors)
- Prestige ring: `ultra-rider`, `all-rounder`

(Exact ring comes from computed prerequisite depth; branch sectors keep Flow /
Explore / Distance recognizable.)

## Node inspection & interaction (enhancement)

- Every visible node is inspectable regardless of state (unlocked, unlockable,
  locked, premium/PRO, blocked by prerequisites, or several tiers ahead). The
  synthetic root is also selectable.
- Clicking/tapping a node selects it and updates the detail panel; it never
  auto-unlocks. Unlocking happens only via the explicit Unlock CTA in the detail
  panel. A movement threshold distinguishes a click from a pan so dragging the
  canvas does not select a node.
- Each node carries a generous invisible SVG hit target (`.skill-node-hit`,
  radius = visible radius + 26) so nodes stay easy to select when zoomed out,
  without enlarging the visible node.
- On hover-capable (mouse) devices, hovering a node shows a compact floating
  tooltip (`.atlas-tooltip`) with the node name, state word (+ PRO), compact
  requirement progress (✓ met / ○ unmet with `current / target`), Skill-Point
  cost, and a short reward summary. It is positioned near the node via the
  viewport's `worldToScreen`, flips below when near the top edge, clamps inside
  the viewport, never captures pointer events, and hides on pointer leave,
  pan, zoom, and scene re-render.
- Keyboard focus on a node shows the same compact preview; Enter/Space selects
  the node. Touch users get the same information by tapping to select.

## Accessibility

- Nodes keep `tabindex`, `role="button"`, and `aria-label`; visible focus
  states; Enter/Space selects.
- Viewport controls are labeled `<button>`s; the viewport is labeled.
- `prefers-reduced-motion` disables connector flow, pulse, focus/zoom
  animation, and unlock pop. Tap targets remain adequately sized.

## Responsiveness

- Desktop: atlas viewport + fixed detail panel (as today).
- Small screens: atlas stays pannable/zoomable; the detail panel stacks below
  per the existing responsive convention; the whole atlas is not forced to an
  unreadable scale.

## Acceptance criteria

- The Skill Tree renders as a radial atlas with a neutral synthetic root at the
  center and Cycling branches fanning outward; Flow / Explore / Distance remain
  recognizable.
- The canvas supports drag-pan, wheel zoom (pointer-centered where practical),
  pinch zoom, clamped min/max, and reset/fit/focus controls that are present but
  visually unobtrusive.
- Node states (unlocked, unlockable, locked, premium) stay immediately
  understandable; gold is the progression color; green is not used for the
  normal unlocked state; PRO indication is small and refined.
- Selecting a node continues to update the fixed detail panel, including the
  "Unlock for X Skill Point(s)" CTA, unmet requirements, completed requirements
  capped at 100%, and the prominent reward section.
- The left nav, page header, Skill-Point card, and detail panel stay fixed
  outside the pannable viewport.
- No change to Skill-Point economy, requirements, unlocked nodes, premium rules,
  APIs, or server-side eligibility semantics; no persisted polar coordinates.
- The layout model supports adding future sports and cross-sport links without a
  redesign, with no fake future gameplay nodes.

## Validation

- `npm test` (vitest): updated client layout/render tests pass; untouched server
  `src/skillTree/**` tests continue to pass.
- `npm run build` (tsc): no type regressions (server untouched).
- Manual: pan/drag, wheel + pinch zoom, zoom clamps, reset/fit/focus, node
  select → detail update, unlock flow + connector animation, keyboard focus,
  reduced-motion, and mobile stacking.
