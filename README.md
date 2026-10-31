# Post-ride AR POC

Single-container POC for turning a FIT ride into collectible game events and an optional GoPro highlight video. The approved Activity Mode milestone adds FIT-only activity results and an animated route replay while preserving the existing GPS5 GoPro rendering flow.

## Features

- [Account and user-data deletion](features/account-and-user-data-deletion/README.md) — delete all user-owned data with an account and safely clean up selected users or all user data while preserving shared catalogs.
- [Activity Detail Animation Polish](features/activity-detail-animation-polish/README.md) — merge XP Earned and What changed into one stable, compact card and keep the end-of-replay panel over the map on mobile.
- [Activity Detail Replay Reward Presentation](features/activity-detail-replay-reward-presentation/README.md) — refine replay rewards with timestamp-driven single-item feedback and deterministic XP presentation while preserving the existing panel.
- [Activity Distance XP Bonus](features/activity-distance-xp-bonus/README.md) — award incremental XP at distance milestones during replay while preserving collectible and Flowline rewards.
- [Activity mode animated ride POC](features/activity-mode-animated-ride-poc/README.md)
  — make FIT activities and game events primary, with a FIT-only replay and
  optional GoPro highlights.
- [Activity Replay Presentation / Game Feel V1](features/activity-replay-presentation-game-feel-v1/README.md)
  — improve the dependency-free activity recap with collectible states, feedback,
  readable score/events, next-item context, and completion presentation.
- [App host redirects and locale-neutral routes](features/app-host-redirects-and-locale-neutral-routes/README.md) — route app hosts into the app, share URLs across languages, and persist the selected locale.
- [Coin collection](features/coin-collection/README.md) — animate Coin pickups
  with a 2.5D Collect effect, reward, and generated audio Chime.
- [Collectible rarity cleanup and category icons](features/collectible-rarity-cleanup-and-category-icons/README.md) — remove Rare/Epic collectible tiers and add distinct SVG map icons for Viewpoint and Place.
- [Coming soon](features/coming-soon/README.md) — add a reusable multi-language
  "Coming Soon" annotation and remove the unsupported Komoot external-route feature.
- [Default quests](features/default-quests/README.md) — *superseded by Explore this
  Area*; generated bbox-local recommendations including Mountain Passes and mixed
  Flowline challenges; track and cancel started quests independently of the map.
- [Dev data reset](features/dev-data-reset/README.md) — dev/localhost-only Profile button that wipes a user's activities, XP, points and quests while keeping the login.
- [Explore Area v2 polish](features/explore-area-v2-polish/README.md) — constrain routes to the selected area, reuse the last Locate Me position, and add arbitrary map points as route-only destinations.
- [Explore this Area](features/explore-this-area/README.md) — route-first exploration:
  choose start and ride length, pick one of several generated routes from the frozen map
  area, tweak its targets, and confirm it as a single exploration.
- [Extend OSM/Wikidata Collectibles](features/extend-osm-wikidata-collectibles/README.md)
  — import named places, improve source retry/cache behavior, and trigger
  private-network DEV/PROD imports manually.
- [Flowline collection on activity replay](features/flowline-collection-on-activity-replay/README.md)
  — show completed flowlines in gold on the replay map from their completion
  timestamps, preserving the geometry recorded with new activity snapshots.
- [GameEvent instead of Coin](features/gameevent-instead-of-coin/README.md) —
  generalize downstream Coin-passage records into typed game events.
- [Highlight planner](features/highlight-planner/README.md) — formalize selected
  game-event timing into a deterministic render manifest before media rendering.
- [Home Active Quests](features/home-active-quests/README.md) — list the player's
  active quests on Home with read-only cards, and link to Staza World when none
  are active.
- [Import data workflow](features/import-data-workflow/README.md) — import
  quäldich, OSM/Wikidata, and Fartlek snapshots into DEV or PROD through GitHub
  Actions while keeping PostgreSQL private on the VPS.
- [HUD](features/hud/README.md) — replace physical-scene Coin visuals with a
  compact, camera-independent route and event overlay.
- [Job lifecycle operational robustness](features/job-lifecycle-operational-robustness/README.md)
  — make local processing jobs lifecycle-safe, isolated, recoverable, and
  retention-aware.
- [Localize public app UI and routes](features/localize-public-app-ui-and-routes/README.md)
  — localize the app interface in English and German and use locale-aware URLs
  for app screens.
- [Make UI Stupid](features/make-ui-stupid/README.md) — move feasible derived
  product data and rules behind backend APIs so native clients can reuse them.
- [Milestone 11.1 — Application shell (historical)](features/milestone-11-1-trailhunt-application-shell/README.md)
  — historical implementation of desktop tokens, shell, sidebar, and main content.
- [Milestone 11.10 — Progress desktop (historical)](features/milestone-11-10-trailhunt-progress-desktop/README.md)
  — historical Figma-aligned Progress implementation.
- [Milestone 11.2 — Home desktop (historical)](features/milestone-11-2-trailhunt-home-desktop/README.md)
  — historical real-data-backed Home implementation.
- [Milestone 11.3 — Activity history desktop (historical)](features/milestone-11-3-trailhunt-rides-desktop/README.md)
  — historical persisted activity history implementation.
- [Milestone 11.4 — Activity detail / Replay (historical)](features/milestone-11-4-trailhunt-ride-detail-desktop-replay/README.md)
  — historical persisted detail and replay implementation.
- [Milestone 11.5 — Activity detail / Collected (historical)](features/milestone-11-5-trailhunt-ride-detail-collected/README.md)
  — historical collected-items detail implementation.
- [Milestone 11.6 — Activity detail / Near Misses (historical)](features/milestone-11-6-ride-detail-desktop-near-misses/README.md)
  — historical near-miss detail implementation.
- [Milestone 11.7 — Activity detail / Video (historical)](features/milestone-11-7-ride-detail-desktop-video/README.md)
  — historical activity-scoped video highlight implementation.
- [Milestone 11.8 — World desktop (historical)](features/milestone-11-8-trailhunt-world-desktop/README.md)
  — historical World browse implementation.
- [Milestone 11.9 — Add Activity and Attach Video (historical)](features/milestone-11-9-trailhunt-add-activity-and-attach-video/README.md)
  — historical idempotent FIT import and video attachment implementation.
- [Milestone 12 — Identity, Authentication & User Accounts](features/milestone-12-identity-authentication-user-accounts/README.md)
  — establish passkey-first identity, email-code recovery, server-side sessions, and user-owned player authorization.
- [Milestone 12B — Authentication UI Integration](features/milestone-12b-authentication-ui-integration/README.md)
  — replace the temporary authentication presentation with the Figma-approved UI while preserving the canonical Milestone 12 auth behavior.
- [Milestone 13 — Profile UI & Account Management Integration](features/milestone-13-profile-ui-account-management-integration/README.md)
  — add Figma-aligned Profile and account-management presentation while retaining canonical account security and Player ownership.
- [Milestone 14 — Staza Brand & Activity Terminology Migration](features/milestone-14-staza-brand-activity-terminology-migration/README.md)
  — migrate active product branding to Staza and establish Activity as the
  cross-sport terminology while preserving core behavior.
- [Milestone 15.1 — Native MapLibre Collectible Rendering](features/milestone-15-1-native-maplibre-collectible-rendering/README.md)
  — render World collectibles as a native MapLibre GeoJSON source and circle
  layers instead of per-collectible DOM markers, removing marker drift.
- [Milestone 15.2 — World Visual Polish & Map Styling](features/milestone-15-2-world-visual-polish-map-styling/README.md)
  — theme the basemap into a muted Staza surface and sharpen marker, selection,
  quest route and legend presentation without changing World behavior.
- [Milestone 15.4 — quäldich Pass Catalog Import](features/milestone-15-4-quaeldich-pass-import/README.md)
  — idempotent, manual importer that seeds World with mountain passes from the
  official ODbL quäldich GeoJSON, preserving source identity and attribution.
- [Milestone 15.6 — Automated OSM/Wikidata Collectible Pipeline](features/milestone-15-6-automated-osm-wikidata-collectible-pipeline/README.md)
  — conservative Germany OSM extract ingestion, Wikidata enrichment, and scored manual
  World catalog import.
- [Milestone 15 — Staza World v1](features/milestone-15-staza-world-v1/README.md)
  — historical World foundation with a MapLibre map and curated collectible
  catalog; quest behavior is now defined by [Default quests](features/default-quests/README.md).
- [Milestone 16.0 — Staza Landing Page](features/milestone-16-0-staza-landing-page/README.md)
  — add an isolated public landing page at `/` while preserving the existing
  authenticated app under `/app` and `/sign-in`.
- [Milestone 18 — Fartlek Segment Challenges](features/milestone-18-fartlek-segment-challenges/README.md)
  — introduce a linear, traversal-based World challenge type backed by a
  conservative OSM candidate pipeline, native MapLibre line rendering, and
  speed-independent completion and XP.
- [Mobile responsiveness](features/mobile-responsiveness/README.md) — make the
  authenticated app and auth screens usable on mobile with a compact bottom
  navigation and focused responsive layouts.
- [Mobile UX Audit](features/mobile-ux-audit/README.md) — audit the app in a
  real browser and improve mobile navigation and responsiveness while preserving
  the existing visual style and desktop behavior.
- [Multi Clip creation](features/multi-clip-creation/README.md) — select detected
  Coin passages and combine them into one chronological highlight video.
- [Multi-Sport Skill Atlas](features/multi-sport-skill-atlas/README.md) — extend the
  cycling Skill Tree into a radial multi-sport atlas with Athlete at the center and
  Cycling, Running, and Hiking as equal sport sectors plus cross-sport and prestige nodes.
- [P0 audit remediation](features/p0-audit/README.md) — plan and resolve the four
  P0 UX-audit findings across FIT sports, Skill Atlas rewards, journey start, and
  the Skill Point economy.
- [P1 audit](features/p1-audit/README.md) — resolve all nine P1 UX-audit findings
  across activity rewards, quests, collectibles, Flowlines, Explore, Home, and
  activity history.
- [P2 audit](features/p2-audit/README.md) — resolve all eight P2 UX-audit findings
  across Atlas polish, World, import (GPX, mandatory sport), activity detail,
  Progress trophy room, and mobile layout.
- [Persistent activities player state v1](features/persistent-activities-player-state-v1/README.md)
  — persist compact activity/event history and single-player XP in PostgreSQL
  with transaction-safe exactly-once progression.
- [Progression V1](features/progression-v1/README.md) — make each completed ride
  contribute XP toward a derived player level without adding persistence or rewards.
- [Reduce unnecessary detours in generated routes](features/reduce-unnecessary-detours-in-generated-routes/README.md)
  — filter or rank low-quality area routes while preserving road geometry,
  route bounds, and destination coverage.
- [Quest Route Exploration V1](features/quest-route-exploration-v1/README.md) —
  *planner reused by Explore this Area*; explore a quest by generating scored ride-route proposals via the standalone
  routing service, then commit the quest and selected PlannedRoute together.
- [Quest target clarity and shared World cards](features/quest-target-clarity-and-shared-world-cards/README.md) —
  list concrete quest targets and requirements on shared World cards, and highlight
  and frame all targets when a quest is selected.
- [Quest UI optimization](features/quest-ui-optimization/README.md) — make quest
  cards easier to scan with World-style objective icons, consistent heights, and
  compact recommendation goal chips and completed Flowline speeds on active
  quests, without adding quest XP or rewards.
- [Road-cycling Flowline extraction refinement](features/road-cycling-flowline-extraction-refinement/README.md)
  — publish high-quality road-cycling Flowlines using explicit suitability,
  confidence, continuity, and history-safe reimport rules.
- [Road-cycling segment intelligence](features/road-cycling-segment-intelligence/README.md)
  — generic multi-score road segment model (flow/endurance/explore + road quality
  and confidence) that Flowlines, route character, and ride-style planning build on.
- [Renderer resilience output validation](features/renderer-resilience-output-validation/README.md)
  — harden highlight rendering with media inspection, timestamp-safe concat, and
  final MP4 validation.
- [Robust sync](features/robust-sync/README.md) — validate the existing FIT/GPS5
  synchronization against manually verified reference events.
- [Route-Relevant World Query V1](features/route-relevant-world-query-v1/README.md)
  — cheaply limit the configured world to the padded geographic region around an
  activity route before existing precise collectible detection and presentation.
- [Saved default map start point](features/saved-default-map-start-point/README.md)
  — persist the latest “Locate Me” position as a home marker, center the World map on startup,
  and replace collectible category glyphs with matching outline icons.
- [Shared Staza Map Foundation](features/shared-staza-map-foundation/README.md)
  — unify World and Activity Detail on one MapLibre Staza map foundation and
  rebuild the Ride Detail replay natively on shared basemap, theme, and layers.
- [Skill Atlas](features/skill-atlas/README.md) — refactor the Skill Tree into a
  pannable, zoomable, radial constellation map (client-only visual/layout/
  interaction refactor) while preserving all gameplay, persistence, and APIs.
- [Skill Points Reflection](features/skill-points-reflection/README.md) — explain
  level-based Skill Point rewards and mark awarding levels in the Progress journey.
- [Skill Tree](features/skill-tree/README.md) — interactive, animated progression
  tree where players spend Skill Points to unlock requirement-gated nodes that
  grant bounded capability access (badges/titles, quest and filter unlocks).
- [Sport-aware Activity XP](features/sport-aware-activity-xp/README.md) — award
  base XP for valid activities and weight distance XP by sport without
  recalculating historical rewards.
- [SMTP auth email delivery](features/smtp-auth-email-delivery/README.md)
  — send authentication codes and security notifications by real email via
  nodemailer SMTP against the existing mail server in production.
- [Staza app DEV/PROD deployment structure](features/staza-app-dev-prod-deployment-structure/README.md)
  — version separate app deployment Compose files, isolated environment storage,
  and manual VPS deployment instructions.
- [Staza GitHub Actions deployment automation](features/staza-github-actions-deployment-automation/README.md)
  — build and deploy immutable DEV images and strictly versioned PROD releases
  to the existing VPS Compose projects.
- [Staza landing page DEV/PROD deployment](features/staza-landing-page-dev-prod-deployment-plan/README.md)
  — plan a self-contained static English/German landing artifact and SSH-based
  DEV/PROD deployment workflows.
- [Staza landing page localization](features/staza-landing-page-localization/README.md)
  — render the public landing page in English and German with localized URLs
  while preserving one shared page structure and the existing app routes.
- [Stable peak loading](features/stable-peak-loading/README.md) — cache a ≥200 km
  area of World collectibles so icons stay put while panning the map.
- [Strava OAuth and manual activity import](features/strava-oauth-manual-activity-import/README.md)
  — connect Strava for an explicit single-activity import through the canonical
  activity pipeline, with an immutable journey-start boundary.
- [Synchronization diagnostics](features/synchronization-diagnostics/README.md)
  — make FIT/GPS5 synchronization failures explicit and operationally visible.
- [UX audit remediation](features/ux-audit-remediation/README.md) — prioritized
  P0–P2 backlog from the product playthrough audit, fixed one finding per session
  to close the Activity → XP → Skill Atlas → Quest game loop.
- [World Collectible Domain Model V1](features/world-collectible-domain-model-v1/README.md)
  — normalize legacy Coin configuration into reusable world Collectibles with
  canonical event relationships and shared replay/HUD presentation metadata.
- [World Filter](features/world-filter/README.md)
  — combine multi-select, marker-keyed World map filters and remove the
  redundant map-overlay legend.
- [Zoom-based Flowline thinning](features/zoom-based-flowline-thinning/README.md)
  — load fewer Flowlines when zoomed out and add a map scale bar.

## World architecture

The World screen is a **browse read model**, not the route-relevant candidate
query used while processing an activity. `GET /api/world` combines the complete
configured collectible catalog with the current player's persisted
`collectible_collected` source IDs. A collectible is Found only when such an
event exists; geographic proximity to a recorded route never establishes
discovery.

The current configured catalog is the World scope. Its catalog-intersected,
distinct player discoveries derive discovered and remaining counts. The UI
filters one loaded snapshot client-side for All, Found, Unfound, and category.

World visibility is separate from discovery. Current snapshots mark all catalog
items `visible`, but each World collectible has a presentation visibility state
so future player-specific explored-area or quest reveal logic can hide
unrevealed items before page filters and markers render. That logic belongs at
the World snapshot/API boundary and must not reuse collection events, route-query
padding, or collection radius. This milestone adds no exploration persistence,
coverage calculation, geospatial tiling, map masking, regions, or quest system.

## Verified POC result

The POC was validated end-to-end with the selected GPS5 GoPro reference setup:

- the FIT track detects passage through the configured coin, including a passage between two FIT samples;
- the GPS5 clock embedded in the GoPro GPMF metadata automatically aligns the FIT and video timelines;
- a playable, correctly trimmed MP4 with the coin overlay downloads successfully.

The GoPro's **GPS clock** is used for synchronization. A camera position fix is not required: samples are clustered to establish a stable UTC video-start time and discard invalid placeholder timestamps.

## Run locally

Requirements: Node.js 22+, PostgreSQL 16+, and FFmpeg/FFprobe with H.264
(`libx264`) support.

```bash
npm install
docker compose up -d postgres
export DATABASE_URL=postgresql://post_ride_ar:post_ride_ar@localhost:5432/post_ride_ar
npm run migrate
npm run build
npm start
```

Open `http://localhost:3000`. The default limits allow uploads up to 6 GiB and
processing for up to 15 minutes so that original multi-gigabyte GoPro chapters can
be processed. Override these values with `MAX_UPLOAD_BYTES` and
`PROCESS_TIMEOUT_MS` when necessary.

The server automatically reads an optional project-root `.env`. Copy
`.env.example` when not using the Compose defaults; environment variables supplied
by the process still take precedence.

`WORLD_QUERY_PADDING_METERS` (default `500`) expands the FIT route's geographic
bounds before configured Collectibles are selected. The server uses that compact
subset for precise passage detection, activity replay, and the optional HUD
timeline; precise geodesic crossing behavior is unchanged. Job status includes
only the `world.totalCollectibles` and `world.relevantCollectibles` counts, not
route or Collectible coordinates. A Collectible's configured collection radius
is included in its coarse query extent so the boundary cannot exclude a passage
that precise detection would otherwise find.

## Synchronization validation

Run `npm run test:sync` to validate the FIT-to-GPS5 mapping against committed
reference fixtures. Fixture JSON is stored in `fixtures/sync`; media is not
committed. Point `SYNC_FIXTURE_ROOT` to a directory containing the FIT and MP4
paths declared by a fixture:

```bash
SYNC_FIXTURE_ROOT=/path/to/reference-media npm run test:sync
```

Absent media is reported as **SKIPPED**. Available media produces one result per
reference event plus aggregate error metrics; an unavailable event, an out-of-video
mapping, a video-start UTC mismatch greater than 1.5 seconds, or an error above
its tolerance exits nonzero. A corrupt available fixture fails its own events but
does not prevent later fixtures from running or the final aggregate summary from
printing. Pass `-- --debug` to show diagnostics for passing events too.
`SYNC_VALIDATION_TIMEOUT_MS` overrides the 15-minute media-processing timeout.

## Run in Docker

```bash
docker build -t post-ride-ar .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL=postgresql://post_ride_ar:post_ride_ar@host.docker.internal:5432/post_ride_ar \
  post-ride-ar
```

`DATABASE_URL` is required and is supplied at runtime; the image does not
contain database credentials. `DEFAULT_PLAYER_ID` defaults to the reserved
UUID `00000000-0000-4000-8000-000000000001` and identifies the single local
player. `DEFAULT_PLAYER_NAME` defaults to `Local player`. Migrations are
ledger-backed and safe to run on every deployment with `npm run migrate`.

For isolated persistence tests, provide a disposable database:

```bash
TEST_DATABASE_URL=postgresql://post_ride_ar:post_ride_ar@localhost:5432/post_ride_ar_test npm run test:persistence
```

## Input requirements

- **FIT:** Must contain at least two time-stamped GPS trackpoints.
- **MP4 (optional):** To generate highlights, use an original GoPro chapter copied directly from the camera. QuickTime trimming, re-encoding, or export removes the required `gpmd` GPMF metadata track.
- **Telemetry:** This POC supports **GPS5** only. The correct GoPro chapter must cover the FIT coin-passage time.
- **Collectibles:** The catalog is stored in the PostgreSQL `collectibles` table
  and populated by the OSM/Wikidata and quäldich import workflows below. No
  demo seed catalog is installed by the application.
- **quäldich pass catalog:** `npm run import:quaeldich` imports cycling mountain
  passes from the official quäldich Pässelexikon GeoJSON
  (`https://www.quaeldich.de/common/js/paesse_geojson.php?license=odbl`, licensed
  **ODbL 1.0**) into the same `collectibles` table as `mountain_pass` records.
  By default it downloads the source; use `npm run import:quaeldich -- --snapshot
  path/to/paesse_geojson.php.json` to read a local GeoJSON file instead. Add
  `-- --dry-run` to validate and report expected changes without writing. The
  importer is manual/on-demand (no scheduled sync) and is never on the runtime
  World request path. It is idempotent: records use the stable identity
  `quaeldich:<TextID>` (`source_type = quaeldich`,
  `source_external_id = TextID`), so re-running updates existing rows instead of
  creating duplicates or rotating ids. Only the licensed elementary fields are
  imported — pass name, coordinates, elevation (`elevation_m`), and TextID;
  gameplay `value` (XP) is derived from elevation via one centralized helper
  (`mountainPassValueFromElevation`).
  Attribution to **quäldich.de** (with a per-pass deeplink
  `https://www.quaeldich.de/paesse/<TextID>/`) is persisted and shown in the
  World collectible detail. The importer reports created/updated/unchanged/
  rejected counts, possible proximity/name duplicates (never auto-merged), and
  records missing from the current upstream (never auto-deleted). Ascent,
  popularity, QDH, surface, and other website content are intentionally **not**
  imported; do not replace this GeoJSON import with website scraping without a
  separate licensing review. See
  [Milestone 15.4](features/milestone-15-4-quaeldich-pass-import/README.md).
  For GitHub Actions, upload the full GeoJSON to
  `/opt/staza/data/quaeldich-sample.geojson` on the VPS, then dispatch the
  quäldich workflow for DEV or PROD. It reads the file through the app
  container's `/import-source` mount; see the
  [deployment guide](ops/app/README.md#manual-quäldich-import). The local
  `import:quaeldich` command uses `tsx`; the remote workflow uses
  `import:quaeldich:dist` because the deployed image contains compiled
  JavaScript, not `tsx`. The committed repository fixture with this name is a
  seven-feature test sample; the workflow reads the file contents staged on the
  VPS, not that repository fixture. The upload command below replaces the VPS
  copy with the full downloaded GeoJSON.
  To stage a downloaded file for the VPS, configure
  `QUAELDICH_VPS_SSH_TARGET` in `.env`, then run
  `npm run move:quaeldich2vps -- path/to/paesse_geojson.php.json`. It validates
  the GeoJSON and copies it to the workflow's expected path; `scp` handles SSH
  authentication and leaves the local file intact.

- **OSM extract snapshot:** The importer reads an uploaded OpenStreetMap extract
  instead of querying a live API. Download the Geofabrik Germany PBF
  locally (`https://download.geofabrik.de/europe/germany-latest.osm.pbf`, ODbL
  1.0), install `osmium-tool`, then run
  `npm run extract:osm-germany [path/to.pbf]`.
  It filters the seven imported object classes, exports geometries (non-point
  objects collapse to their bounding-box center), keeps only the retained tag
  keys, and writes `fixtures/osm-germany.json` with `metadata` (source URL,
  extract version, attribution, license, selectors, counts) plus `records`.
  Upload that snapshot to `/opt/staza/data/osm-germany.json` on the VPS before
  running its workflow. The PBF and generated snapshots are not needed in the
  VPS repository or app image.
- **OSM/Wikidata collectible catalog:** `npm run import:osm-wikidata` imports the
  uploaded snapshot in its VPS workflow (locally, override with
  `-- --snapshot <file>` or `OSM_SNAPSHOT_FILE`)
  of German OpenStreetMap landmarks (`© OpenStreetMap contributors`), enriches it
  with Wikidata, and writes `landmark` records into the `collectibles` table.
  Besides viewpoints, peaks, castles, and waterfalls it imports named
  `place=square`, `place=quarter`, and named `tourism=attraction` objects as the
  `place` primary category; existing categories still win for objects that match
  both, and place candidates without a meaningful name are rejected. Add
  `-- --dry-run` for a report without database writes and `-- --force-refresh`
  to refresh Wikidata. The importer is manual, idempotent, never deletes missing
  records, and only upserts `AUTO_PUBLISH` candidates. Uncached Wikidata batches
  wait `WIKIDATA_BATCH_DELAY_MS` (default `5000`) between requests; transient
  errors, timeouts, HTTP 429, and HTTP 5xx retry up to `WIKIDATA_MAX_ATTEMPTS`
  (default `5`) with exponential backoff that honors `Retry-After`, while
  non-transient client errors fail immediately. Exhausted lookups fall back to
  validated stale cache where available and are reported. While running, the
  importer logs timestamped UTC progress lines
  (`[12:00:00Z] [wikidata] batch 7/96: resolved 50 QIDs`) for every batch,
  pacing wait, retry, and phase, so a long pause is always attributable. The
  Wikidata cache lives under ignored `data/` by default and can be moved with
  `OSM_WIKIDATA_CACHE_DIR`. On servers the manual
  "Import OSM/Wikidata collectibles" GitHub workflow runs the deployed image as
  a one-off Compose container on the private network; see
  [the deployment guide](ops/app/README.md#manual-osmwikidata-collectible-import).

The app derives the event in three steps:

```text
Collectible coordinates → FIT track crossing time → GPS5-clock-aligned video second
```

Each detected Collectible is represented downstream as a
`collectible_collected` `GameEvent` containing canonical `sourceId`, compact
event-time name/type presentation metadata, value, coordinates,
unrounded FIT entry-crossing `activityTimestamp`, and millisecond-rounded
`videoSecond`. Its `id` remains a temporary compatibility alias for `sourceId`.
The app lists the first detected passage for each configured Collectible. Select
the passages to include, then download one chronological highlight video. Each event uses a
three-second-before/-after window; overlapping or adjacent windows are merged.
Before rendering, the pure `planHighlights` API creates this deterministic
manifest from selected events: it ignores out-of-video events, deduplicates IDs,
orders equal timestamps by ID, preserves fractional seconds, clamps windows to
the source duration, and reports the merged source duration. The renderer then
resolves each manifest event ID back to its selected `GameEvent` for HUD and
legacy effect rendering.
The default output adds a screen-space HUD: a fixed, heading-aligned map of the
current clip segment where the rider moves toward the top and turns with the
route. It includes nearby Coin markers, a subtle north compass, the next detected
Coin and its direct distance, and a brief collection feed. It uses only FIT/GPS
timing and does not depend on camera pose, road geometry, or image analysis.
Rendered clips always contain a 48 kHz stereo AAC audio track. Source audio is
trimmed and preserved when present; sources without audio receive a generated
silent track so segment concatenation remains safe. Before rendering, the source
must expose a readable H.264 or HEVC video stream with valid dimensions and
duration. The renderer rejects invalid highlight intervals, renders in plan order,
cleans isolated temporary artifacts, and FFprobes the completed MP4. A job fails
rather than exposing an unreadable output, missing video/audio stream, or output
whose duration is outside the renderer's container/encoding tolerance.

HUD behavior can be configured with `HUD_ENABLED`, `MINIMAP_ENABLED`,
`EVENT_FEED_ENABLED`, `NEXT_ITEM_ENABLED`, `MAP_RANGE_METERS` (default `150`),
`EVENT_FEED_DURATION_SECONDS`, `EVENT_FEED_MAX_ITEMS`, and `HUD_FRAME_RATE`.
Set `SHOW_LEGACY_COIN_OVERLAY=true` to restore the previous centered Coin effect
with its audio behavior; it is disabled by default.

## Synchronization diagnostics

Synchronization uses UTC epoch milliseconds throughout. The job status includes a
compact `synchronization` summary with confidence, warnings, overlap, and
available/outside-video passage counts. A valid FIT/GPS5 overlap is required
before highlights are mapped; passages outside the video are classified as
`EVENT_OUTSIDE_VIDEO` and are not rendered.

Processing stops with an actionable code rather than guessing timing when it
finds `NO_GPMD_TRACK`, `UNSUPPORTED_VIDEO_METADATA`, `NO_VALID_VIDEO_CLOCK`,
`INVALID_FIT_TIMESTAMPS`, or `NO_OVERLAPPING_TIME_RANGE`. Set
`FIT_SAMPLE_GAP_WARNING_SECONDS` (default `30`) to report long FIT sample gaps
without reconstructing missing track data.

## Operations

Only one telemetry or render job runs at a time. Each job receives a random token
used for status polling and download. Detection releases the renderer while the job
waits for selection; selections expire after 30 minutes by default. Uploads,
telemetry artifacts, and result clips are deleted after 30 minutes. To guard server
resources, at most 20 Coins and 120 seconds of merged output can be selected; set
`MAX_SELECTED_COINS`, `MAX_OUTPUT_DURATION_SECONDS`, `SELECTION_TTL_MS`, or
`JOB_TTL_MS` to override the defaults.

Legacy job JSON, uploads, telemetry artifacts, generated HUD files, and rendered
video remain transient and follow these TTLs. Add Activity and Ride Detail video
attachment store source and rendered media in `MEDIA_DIR` (default
`./data/media`) outside the TTL job root; PostgreSQL stores activity-scoped
metadata, state, and media references—not MP4 binaries. A valid FIT activity is
committed before optional video synchronization or rendering, so later video
failure does not remove its history or XP.

When `NODE_ENV` is not `production` (localhost and the DEV stage), Profile →
Account & Security shows a DEVELOPMENT section with "Reset my game data". It calls
`POST /api/dev/reset-data` and deletes the signed-in player's activities, XP,
quests, progress and media while keeping the login, passkeys and Strava connection.
The endpoint is not registered in production.

## API

- `POST /api/jobs` multipart fields: required `fit`, optional `video`
- `GET /api/jobs/:token`
- `GET /api/jobs/:token/activity`
- `POST /api/jobs/:token/render` JSON body:
  `{ "sourceIds": ["collectible-a", "collectible-b"] }`. The legacy
  `{ "coinIds": [...] }` field remains accepted temporarily as an alias.
- `GET /api/jobs/:token/download`
- `POST /api/activities/import` multipart fields: required `fit`, optional
  `video`, and required `Idempotency-Key`. Returns the persisted activity and
  starts optional video processing separately.
- `GET /api/integrations/strava` returns whether Strava import is enabled and
  the safe connection status (`disconnected`, `connected`, or
  `reconnect_required`); no tokens are ever returned.
- `POST /api/integrations/strava/authorize` (CSRF) starts OAuth with a
  one-time, session-bound state and returns the Strava authorization URL;
  `GET /api/integrations/strava/callback` completes it server-side and
  redirects back to Add Activity with a `?strava=` outcome.
- `GET /api/integrations/strava/activities` fetches one first page of recent
  activities on demand and returns only the newest ones with GPS data
  (`STRAVA_RECENT_ACTIVITY_LIMIT`, default 3).
- `POST /api/integrations/strava/activities/:id/import` (CSRF) imports exactly
  one listed activity through the canonical FIT pipeline and transaction
  (`201` new, `200` existing). Duplicates and pre-journey activities return
  `409` with `code` `duplicate_activity` or `before_journey_start`.
- `DELETE /api/integrations/strava` (CSRF) deletes local credentials and
  attempts remote deauthorization; imported activities and XP remain.
- `GET /api/activities` returns the default player's completed activities,
  newest first, with compact summary fields.
- `GET /api/activities/:id` returns one persisted activity and its ordered
  event-time collectible snapshots.
- `POST /api/activities/:id/video` multipart field: required `video`; attaches
  one canonical source video to an existing activity without changing activity
  or player progression.
- `POST /api/activities/:id/video/render` submits selected persisted event
  `sourceIds`; preview and download are available at the corresponding
  `/video/preview` and `/video/download` routes once highlights are ready.
- `DELETE /api/activities/:id/video` clears only a failed or no-highlight
  source-video attachment so the existing ride can accept another upload.
- `GET /api/world` returns the complete configured collectible catalog with
  player-scoped persisted discovery state and catalog-derived World statistics.
- `GET /api/player/progress` returns durable `totalXp` and the derived level
  curve values `level`, `currentLevelXp`, `nextLevelXp`, and
  `progressToNextLevel`.
- `GET /api/player/progress-dashboard` returns the same canonical player
  progress together with player-scoped lifetime distance and unique collectible
  totals, canonical nearby level thresholds, and the four newest
  persisted Ride summaries for the Progress Desktop.
