# Milestone 18 — Fartlek Segment Challenges

## Goal

Introduce a new linear World challenge type called `fartlek`: a defined road/path
segment that a player completes by traversing it during an activity.

A Fartlek is completed based on **traversal of the segment only**. Completion does
NOT depend on average speed, max speed, leaderboard rank, beating a previous time, or
reaching a speed threshold. Speed/time metrics are recorded and shown as activity
statistics only — this is intentionally **not a "speedgate"**.

## Product concept

Point Collectibles (unchanged): `mountain_pass`, `viewpoint`, `peak`, `castle`,
`waterfall`.

Linear challenges (new): `fartlek`.

A Fartlek is **not** a `PointCollectible`. It is a route/segment-based challenge with
a start, finish, geometry, length, suitability metadata, and completion history.
Conceptually:

```text
WorldObject
├── PointCollectible
└── SegmentChallenge
    └── Fartlek
```

Fartlek must not be mixed into point-radius collection semantics.

### Core completion rule

A Fartlek becomes completed when the player's activity traverses the full segment
(bidirectional in v1 — see Direction semantics). Completion is binary
(`completed = true`) regardless of how fast or slow the traversal was. Recorded
per completion: elapsed time, average speed/pace, max speed if reliably derivable,
activity id, and `completed_at`.

## Current architecture (audit findings)

- **Domain** (`src/domain.ts`): `Collectible` is point-radius only
  (`latitude/longitude/radiusMeters`). No LineString concept exists yet.
- **World API** (`src/server.ts` `/api/world`, `/api/world/basemap`): bbox-filtered,
  returns `{collectibles, stats, quests, truncated}` via `createWorldSnapshot`
  (`src/world.ts`) + `CollectibleRepository.listWithinBounds`
  (`src/persistence/collectibleRepository.ts`).
- **Geometry** (`src/geometry.ts`, `src/worldQuery.ts`): point-radius passage
  detection (`detectCollectiblePassage`), bbox math, antimeridian-safe bounds. No
  corridor/segment-traversal primitives yet.
- **Activity processing** (`src/activity.ts`): `deriveActivityResult(activity,
  collectibles)` is the single canonical pipeline entry used for both FIT and Strava
  sources (`Activity.source` only tags origin). Near-miss logic shows the pattern for
  route-vs-geometry math.
- **Quests** (`src/quest.ts`, migration `011_quests`): already stores a simplified
  `LineString` route (`quest_routes.geometry JSONB`) from activities — an established
  pattern for JSONB LineString storage.
- **Progression/XP** (`src/progression.ts`): XP = `activityResult.totalPoints` (sum of
  collectible `value`s, 20–50 range), persisted via `activityRepository`
  (`xp_earned` column, `activities` table). No speed-based XP anywhere today.
- **OSM pipeline** (`src/osm/*`): not live Overpass — an offline **Geofabrik PBF →
  osmium export → snapshot JSON** pipeline (`buildOSMSnapshot.ts`, `snapshot.ts`),
  filtered by point-tag `OSM_SOURCE_CLASSES` selectors (`selectors.ts`), scored in
  `score.ts` (`AUTO_PUBLISH/REVIEW/IGNORE/REJECT`, 0–100 scale), deduped/published in
  `import.ts`. **`OSMRecord` only stores a single lat/lon centroid — no way geometry
  or continuity is captured today.** Fartlek requires full `LineString` way geometry,
  so this is new extraction, not just a new selector.
- **MapLibre** (`public/components/shared/map/staza-map.js`,
  `staza-collectible-layers.js`): one shared map core (`createStazaMap`), one GeoJSON
  source per concern with data-driven, property-based layers (e.g. `circle-color:
  ["match", ["get","category"]...]`). This is the template for a line-based Fartlek
  source.
- **World UI** (`world-page.js`, `world/collectible-detail.js`): tab/filter-based
  (`All/Collectibles/...`), click → select → detail-panel pattern already exists.
- **Activity Detail** (`activity-detail-page.js`, `activity-tabs.js`,
  `replay-tab.js`): only two tabs exist (REPLAY, VIDEO); Collected/Near Misses are
  **sections inside the REPLAY tab**, not separate tabs — Fartleks follow the same
  sub-section pattern.
- **Persistence conventions** (`migrations.ts`): additive numbered migrations, `CHECK`
  constraints for enums, dedicated junction tables (`quest_collectibles`), `JSONB` for
  geometry/metadata, unique partial indexes for idempotency (e.g.
  `activities_player_source_external_id_unique`).

## Decisions

1. **Domain/storage model**: dedicated tables, not an extension of `collectibles`.
   New table `fartleks` (not a `CollectibleCategory`). `WorldObject` is a conceptual
   union at the API/type level (`WorldCollectible | WorldFartlek`), never a shared DB
   table.
2. **Direction semantics**: bidirectional in v1. Canonical `start`/`end` stored;
   completion detects either `A→B` or `B→A`. A nullable `direction_restricted` flag
   is reserved for future one-way support without a migration.
3. **XP**: flat `FARTLEK_COMPLETION_XP = 50` per completion (matches the `peak`
   collectible tier, the highest existing single-collectible value), independent of
   length/speed, summed into the existing `totalPoints`/`xpEarned` pipeline.
4. **Length bounds**: minimum 1 km, ideal range 2–8 km, maximum ~15 km (penalize
   outside the ideal range, hard-reject below the minimum).
5. **AUTO_PUBLISH thresholds**: `suitabilityScore ≥ 80` AND `mappingConfidence ≥ 85%`
   AND no hard-reject flags. `REVIEW`: `suitabilityScore ≥ 55` OR `mappingConfidence`
   50–85%, plausible geometry. `IGNORE`: below the REVIEW floor, no hard violations.
   `REJECT`: explicit access/safety incompatibility or malformed geometry.
6. **Quest readiness**: completion data must carry everything a future
   `fartlek_count` Quest rule needs (`fartlek_id`, `length_m_snapshot`, `activity_id`),
   with zero Quest-specific logic baked into Fartlek completion.
7. **Historical activities**: no automatic reprocessing or retroactive XP when new
   Fartleks are published; new Fartleks apply to future activity processing only.
8. **Geometry stability**: historical `FartlekCompletion` rows snapshot length and a
   geometry version so later OSM refreshes never rewrite historical metrics.

## Domain model

### `Fartlek`

```text
Fartlek {
  id, name, geometry (LineString), startLat, startLon, endLat, endLon,
  lengthMeters, status: 'published' | 'archived',
  source: { sourceType: 'osm', sourceExternalId, sourceAttribution },
  sourceMetadata (OSM way ids, candidate/scoring version),
  suitabilityScore, suitabilityReasons[], mappingConfidence,
  createdAt, updatedAt
}
```

### `FartlekCompletion`

```text
FartlekCompletion {
  id, fartlekId, playerId, activityId, completedAt,
  elapsedTimeS, averageSpeedMps, maxSpeedMps?, traversalDirection?: 'a_to_b' | 'b_to_a',
  fartlekLengthMSnapshot, fartlekGeometryVersionSnapshot
}
```
Unique on `(activity_id, fartlek_id)` — mirrors `activity_events (activity_id,
source_id)` — so reprocessing/replay is a safe upsert/no-op and never creates
duplicate completions. Historical completion rows remain stable even if the source
Fartlek's geometry is later refreshed.

## Traversal detection algorithm

- Build a **buffered corridor** (polygon) around the Fartlek LineString using a
  fixed buffer (~20–25 m) — wider than typical consumer GPS error, narrower than
  typical road-to-road spacing, and distinct from the 200 m near-miss radius used for
  point collectibles.
- **Start/end gates**: short perpendicular segments at each end (e.g. 15 m gate
  width), analogous to `detectCollectiblePassage`'s interpolated crossing.
- **Progression check**: project each in-corridor route point onto the Fartlek's
  arc-length parameterization (reusing the local-projection technique from
  `quest.ts`'s `perpendicularDistanceMeters`); require monotonic progression (small
  backtrack tolerance allowed) from gate A to gate B.
- **Coverage ratio**: require ≥95% of the segment's arc length to have a projected
  route point within the corridor, in order.
- **Rejected as non-completion**: partial coverage, touching only one gate, crossing
  via a parallel/different road (no continuous in-corridor progression), simple
  proximity without ordered traversal.
- Resample/interpolate the activity route at a fixed time or distance step before
  projection so detection works uniformly regardless of source sampling rate (FIT,
  Strava, future Garmin), per the single canonical `deriveActivityResult` pipeline.

## Activity processing integration

Fartlek detection is integrated into the canonical activity processing pipeline
(`src/activity.ts`) alongside existing point collectible detection. The same
normalized activity route is evaluated regardless of source:

```text
FIT / Strava / future Garmin
  → canonical activity route
  → existing point collectible detection
  → Fartlek segment detection
  → events / completion
  → XP
```

No source-specific (Strava-only or FIT-only) Fartlek implementation is created.

## Activity metrics

Canonical units are unit-neutral: `elapsed_time_s` (from the activity timeline),
`average_speed_mps = length_m_snapshot / elapsed_time_s`, and optional
`max_speed_mps` only when the source has reliable per-point timing/speed. UI
formatting (km/h for cycling, pace for running/hiking) lives entirely in the
presentation layer. Speed/time are never used to gate completion or scale XP; a slow
traversal completes identically to a fast one. Missing speed samples do not
invalidate an otherwise valid traversal when time/distance allow the required
metrics.

## OSM candidate pipeline

### Extraction strategy

Reuse the existing Geofabrik + osmium **snapshot/normalize/score/import**
architecture (file-based, offline), but add a new way-geometry-preserving extraction
mode — a new `OSMWayRecord` type (parallel to `OSMRecord`) capturing full coordinate
arrays for `highway` ways plus `traffic_sign=city_limit` nodes for boundary
candidates. This is net-new extraction work, not a new selector on the existing
point-centroid snapshot format.

### Candidate generation

Generate candidate segments between logical boundaries (e.g.
`traffic_sign=city_limit` end → continuous road → next `traffic_sign=city_limit`
begin), emphasizing roads between settlements with clear, continuous geometry. Not
every city-limit pair produces a good candidate.

### Positive signals

Continuous road geometry; `surface=asphalt`; `smoothness=excellent|good`; bicycle
access allowed; appropriate road class; clear start/end boundaries; sufficient
segment length; low junction density; low traffic-control density; priority-road
evidence; consistent road identity/ref/name; mostly non-urban section. Missing
metadata is treated differently from explicit positive metadata — it is never
treated as positive evidence.

### Negative / rejection signals

`bicycle=no`; `access=private`; unknown/low-confidence surface; traffic calming;
stop signs within the segment; dense traffic-signal intersections; railway
crossings; complicated junctions; roundabout-heavy segments; dense urban/pedestrian
context; construction/service-road context; ferries; `motorway`/`motorway_link`;
trunk-like roads unsuitable for cycling. The pipeline is conservative — false
negatives are preferred over unsafe-looking auto-publications.

### Length

Minimum ~1 km; preferred range 2–8 km; maximum ~15 km. Length influences candidate
quality but is not the only criterion.

### Mapping completeness

A separate 0–100% `mappingConfidence` score, independent of `suitabilityScore`:
percentage of segment length with known `surface`, `smoothness`, `bicycle`/`access`,
`maxspeed` tags, plus junction/control completeness. Answers "is the metadata
complete enough to trust?" — not "how good is the road?".

### Scoring and thresholds

Every candidate carries `suitability_score`, `mapping_confidence`, `score_reasons`,
and `decision`.

| Example | Length | Suitability | Mapping confidence | Decision |
|---|---|---|---|---|
| Continuous secondary road, 100% asphalt, 92% smoothness known/good, bicycle allowed, no calming/crossings, low junction density, 1 minor junction | 3.8 km | 88 | 94% | AUTO_PUBLISH |
| Continuous road, asphalt only 40%, smoothness mostly missing, bicycle metadata incomplete | 4.1 km | 70 | 45% | REVIEW |
| `bicycle=no` | 2.9 km | n/a | n/a | REJECT |
| Several stop signs and signals, inconsistent surface | 1.8 km | 35 | 80% | IGNORE |
| Continuous, complete tags, 1 minor junction | 6.2 km | 90 | 97% | AUTO_PUBLISH |

Thresholds:
- **AUTO_PUBLISH**: `suitabilityScore ≥ 80` AND `mappingConfidence ≥ 85%` AND no
  hard-reject flags.
- **REVIEW**: `suitabilityScore ≥ 55` OR `mappingConfidence` 50–85%, plausible
  geometry.
- **IGNORE**: below the REVIEW floor, no hard violations.
- **REJECT**: explicit access/safety incompatibility or malformed geometry.

A high numerical score never overrides missing critical safety/access metadata —
such candidates go to REVIEW, not AUTO_PUBLISH.

### Manual review readiness

No new admin UI is required for v1. REVIEW candidates store enough information to be
inspected externally: map geometry, score, completeness, reasons, source OSM IDs, key
OSM tags, length, and rejection warnings — optionally emitted as JSONL/CSV, matching
the existing OSM pipeline's reporting style.

### Attribution

Fartlek source metadata identifies the relevant OSM ways/nodes, candidate-generation
version, and scoring version. Existing OpenStreetMap, OpenFreeMap, and quäldich
attribution is preserved unchanged.

### Running the pipeline

Implemented as `src/osm/fartlekSelectors.ts`, `fartlekNormalize.ts`,
`fartlekSnapshot.ts`, `buildFartlekSnapshot.ts`, and `fartlekCandidates.ts` — parallel
to the existing point-collectible pipeline (`snapshot.ts`/`normalize.ts`/`model.ts`),
but preserving full way `LineString` geometry instead of collapsing to a centroid.

```bash
# 1. Download a Geofabrik extract (once; large file, not committed).
curl -O https://download.geofabrik.de/europe/germany-latest.osm.pbf

# 2. Extract + build the committed way-geometry snapshot (requires osmium-tool).
npm run extract:osm-germany-fartleks -- germany-latest.osm.pbf
# writes fixtures/osm-germany-fartleks.ndjson

# 3. Generate candidates, score them, and publish AUTO_PUBLISH results.
npm run import:fartleks -- --snapshot fixtures/osm-germany-fartleks.ndjson \
  --write-review tmp/fartlek-review.jsonl
```

`--snapshot` runs `buildFartlekCandidates` (chain-building between `ref`/`name`
identity, splitting at `traffic_sign=city_limit` boundary nodes, counting junctions
and nearby traffic-control nodes) and `scoreFartlekCandidate` per candidate; only
`AUTO_PUBLISH` candidates are upserted. `--write-review <file>` writes the scored
REVIEW/IGNORE/REJECT candidates (one JSON object per line) for manual inspection.
Add `--dry-run` to preview without touching the database. `--candidates <file>` and
`--fartleks <file>` remain available for hand-authored/manually-curated input.

Known simplifications (documented in code, not fully spec-literal): `mostlyNonUrban`
is a heuristic from `highway=residential`/`lit`/`maxspeed` tags (OSM ways rarely carry
reliable `landuse`); junction detection matches way endpoints by coordinate rather
than true OSM node IDs (unavailable from `osmium export` GeoJSON); chains with no
boundary-node hits still produce one whole-chain candidate with
`hasClearBoundaries: false` rather than being discarded.

The bulk-extraction highway selector (`FARTLEK_HIGHWAY_CLASSES`) intentionally omits
`residential` and `cycleway`: nationwide, residential ways alone number in the
millions, and keeping full way geometry for all of them exhausts the Node heap during
a country-scale extract. Fartlek segments are meant to be continuous rural roads
between settlements, so restricting extraction to primary/secondary/tertiary/
unclassified through-roads is both a practical necessity and consistent with intent.
(Hand-authored `--candidates`/`--fartleks` input can still include residential/
cycleway ways — only the bulk OSM selector is narrowed.) If a future nationwide
extract still runs out of memory, raise
`NODE_MAX_OLD_SPACE_MB=16384 npm run extract:osm-germany-fartleks -- <pbf>`.

## World API

`/api/world` response gains `fartleks: WorldFartlek[]` (LineString geometry, name,
`lengthMeters`, `completed`, `selected`, source/category, activity metrics when
completed) as a field distinct from `collectibles` — a Fartlek is never serialized as
if it were a point collectible. Viewport/bbox loading behavior is preserved.

## MapLibre rendering

New `staza-fartlek-layers.js`, following the shared map foundation's conventions
(`staza-map.js`, `staza-collectible-layers.js`): one GeoJSON source
(`staza-fartleks`) with `LineString` features, property-driven `line` layers (not one
source per Fartlek, not DOM overlays). Layer order:

```text
basemap → routes/activity layers → Fartlek segment layers → point collectibles
  → selected/emphasis layers → transient activity position
```

Fartleks render clearly on the road without overpowering the basemap, using the
existing Staza visual language (no neon/arcade styling). Supported states:
available/uncompleted, completed, selected (data-driven MapLibre styling, consistent
with the collectible layer's `match`/`case` paint-expression pattern).

## Click / selection

Fartlek lines are clickable via a wider invisible hit-area line layer (~16 px) bound
through `map.on("click", HIT_LAYER, ...)`, feeding the existing World
selection/detail flow — no pixel-perfect clicking requirement on a narrow road line.

## Filtering

Extend the existing `worldFilters` tab list (`world-page.js`) with a `Fartleks`
entry alongside `All`/`Collectibles`. Existing `Found`/`Unfound`/`Rare`/`Epic` and
category filters remain collectible-only and unaffected; Fartleks get their own
completed/uncompleted filtering.

## World detail

Selecting a Fartlek shows name, start→finish, length, and completion status. If
completed: latest time, average speed/pace, best time, completion count. If never
completed: "Complete the full segment in one activity." Wording never implies a
speed target (e.g. never "drive as fast as possible").

## Activity Detail integration

Completed Fartleks appear as a new section inside the existing REPLAY tab, alongside
Collected and Near Misses (no new tab, no disruption to Replay/Collected/Near
Misses/Video). Shown per completed Fartlek: name, length, elapsed time, average
speed/pace, optional max speed, completion state.

## Replay

If straightforward, completed Fartlek segments are shown as activity-specific map
overlays during replay, without changing replay timing/animation and without
arcade-style "speed boost" effects. If this materially expands scope, it is deferred
and the reason reported.

## Quest readiness (not implemented yet)

`FartlekCompletion` data is structured so a future rule-based Quest (e.g. "Complete 5
Fartleks of at least 2 km each in one activity", `type = fartlek_count`, criteria
`min_count`/`min_length_m`/`same_activity`) is possible without any Quest-specific
logic inside Fartlek completion itself.

## Historical activities and source changes

New Fartleks apply only to future activity processing — no automatic reprocessing of
historical activities and no retroactive XP. If OSM candidate geometry changes in a
later refresh, historical `FartlekCompletion` metrics are not rewritten; completions
snapshot enough information (`fartlekLengthMSnapshot`,
`fartlekGeometryVersionSnapshot`) to remain meaningful independent of current World
geometry.

## Out of scope

Climbs; elevation-derived climb detection; speed thresholds; KOM/QOM; leaderboards;
user-vs-user ranking; "go faster" XP; max-speed achievements; Strava segments;
competitive timing; automatic historical backfill; route planning; Fartlek Quests;
social sharing; live navigation; safety guarantees based on OSM.

## Design principle

A Fartlek is "a good, flowing segment to complete during an activity." It is **not**
"a road where Staza tells you to ride as fast as possible." Completion is binary;
performance metrics are historical/personal context only.

## Implementation plan (files/schema expected to change)

**New:**
- `src/fartlek.ts` — domain helpers (XP constant, metric derivation)
- `src/fartlekDetection.ts` — corridor/gate/coverage traversal algorithm
- `src/osm/fartlekModel.ts` — `OSMWayRecord`, `FartlekCandidate` types
- `src/osm/fartlekScore.ts` — suitability + mapping-completeness scoring
- `src/persistence/fartlekRepository.ts` — `fartleks` table access
- `src/persistence/fartlekCompletionRepository.ts` — `fartlek_completions` table
  access
- `migrations.ts` entry: `fartleks`, `fartlek_completions` tables
- `public/components/shared/map/staza-fartlek-layers.js` — MapLibre source/layers
- World/Activity-Detail UI additions (filter tab, detail panel, replay-tab section)

**Touched:**
- `src/domain.ts` (+ `Fartlek`, `WorldFartlek`, `FartlekCompletion` types)
- `src/world.ts` / `src/worldQuery.ts` (+ fartleks in snapshot/query)
- `src/activity.ts` (invoke Fartlek detection in the canonical pipeline)
- `src/server.ts` (`/api/world` payload includes `fartleks`)
- `public/components/world-page.js` (filter tab)
- `public/components/replay-tab.js` (Fartlek completions section)

## Acceptance criteria

- A Fartlek is completed only by evidence of full-segment traversal; speed, pace,
  and leaderboard concepts never gate completion.
- Completion is idempotent: reprocessing/replaying the same activity never creates a
  duplicate completion or awards XP twice.
- A Fartlek completes in both directions (v1 bidirectional rule) when traversed with
  sufficient corridor coverage; partial traversal, near-segment passes, and
  different-road crossings do not complete it.
- XP awarded per completion is the flat `FARTLEK_COMPLETION_XP` constant regardless
  of elapsed time or speed.
- World API returns Fartleks as LineString `WorldFartlek` objects distinct from point
  `WorldCollectible`s; existing point collectible behavior is unaffected.
- World UI renders Fartleks as native MapLibre line layers (no DOM overlays), with
  available/completed/selected states, click-to-select, and filter support.
- Activity Detail's REPLAY tab shows completed Fartleks (name, length, elapsed time,
  average speed/pace, optional max speed) without disrupting existing
  Replay/Collected/Near Misses/Video sections.
- OSM candidate pipeline produces `AUTO_PUBLISH`/`REVIEW`/`IGNORE`/`REJECT` decisions
  per the documented thresholds, with explainable `score_reasons` and
  `mapping_confidence` stored per candidate.
- No historical activity is automatically reprocessed and no retroactive XP is
  granted when new Fartleks are published.
- Existing OpenStreetMap/OpenFreeMap/quäldich attribution remains intact.

## Validation

### Automated tests
- **Candidate pipeline**: deterministic fixtures for HIGH QUALITY (→ AUTO_PUBLISH),
  INCOMPLETE (→ REVIEW), BAD ACCESS (→ REJECT), BAD ROAD (→ IGNORE/REJECT),
  mapping-completeness calculation, and scoring-reasons determinism (candidate score
  ≠ gameplay XP).
- **Activity completion**: full A→B traversal completes; full B→A traversal
  completes (bidirectional); partial traversal does not complete; passing near the
  segment does not complete; crossing both ends via another road does not falsely
  complete; GPS drift within tolerance completes; repeated processing is idempotent;
  the same Fartlek can be completed again in a different future activity; one
  activity creates at most one completion per Fartlek.
- **Metrics**: elapsed time from the canonical activity timeline; average speed
  derived correctly; canonical unit storage; optional max speed handled correctly;
  slow traversal still completes; speed never affects XP/completion; missing speed
  samples don't invalidate an otherwise-valid traversal.
- **World**: Fartlek appears in bbox query; geometry is `LineString`; filtering
  works; completed/uncompleted state is correct; click selection works; point
  Collectibles remain unaffected; MapLibre source updates without map recreation.

### Manual validation
1. Generate/import Fartlek candidates for a representative German area.
2. Inspect AUTO_PUBLISH candidates manually.
3. Inspect REVIEW candidates.
4. Confirm obviously poor roads are not auto-published.
5. Open World; verify Fartleks align visually with roads.
6. Verify the Fartlek filter.
7. Click a Fartlek; inspect its detail view.
8. Process an activity that traverses one; verify completion.
9. Verify elapsed time and average speed/pace.
10. Verify XP does not depend on speed.
11. Replay/reprocess the same activity; verify no duplicate completion/XP.
12. Verify existing Collectibles/Quests remain intact.
13. Verify no console errors.
14. Run the full test suite and build.
