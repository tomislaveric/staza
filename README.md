# Post-ride AR POC

Single-container POC for turning a FIT ride into collectible game events and an optional GoPro highlight video. The approved Activity Mode milestone adds FIT-only activity results and an animated route replay while preserving the existing GPS5 GoPro rendering flow.

## Features

- [Activity mode animated ride POC](features/activity-mode-animated-ride-poc/README.md)
  — make FIT activities and game events primary, with a FIT-only replay and
  optional GoPro highlights.
- [Activity Replay Presentation / Game Feel V1](features/activity-replay-presentation-game-feel-v1/README.md)
  — improve the dependency-free activity recap with collectible states, feedback,
  readable score/events, next-item context, and completion presentation.
- [Coin collection](features/coin-collection/README.md) — animate Coin pickups
  with a 2.5D Collect effect, reward, and generated audio Chime.
- [GameEvent instead of Coin](features/gameevent-instead-of-coin/README.md) —
  generalize downstream Coin-passage records into typed game events.
- [Highlight planner](features/highlight-planner/README.md) — formalize selected
  game-event timing into a deterministic render manifest before media rendering.
- [HUD](features/hud/README.md) — replace physical-scene Coin visuals with a
  compact, camera-independent route and event overlay.
- [Job lifecycle operational robustness](features/job-lifecycle-operational-robustness/README.md)
  — make local processing jobs lifecycle-safe, isolated, recoverable, and
  retention-aware.
- [Localize public app UI and routes](features/localize-public-app-ui-and-routes/README.md)
  — localize the app interface in English and German and use locale-aware URLs
  for app screens.
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
- [Milestone 11.6 — Activity detail / Near Misses (historical)](features/milestone-11-6-trailhunt-ride-detail-desktop-near-misses/README.md)
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
  — conservative cached Germany Overpass ingestion, Wikidata enrichment, and scored manual
  World catalog import.
- [Milestone 15 — Staza World v1](features/milestone-15-staza-world-v1/README.md)
  — replace the mock World map with a real MapLibre basemap, viewport-driven
  curated collectibles and quests, and quests created from completed activities.
- [Milestone 16.0 — Staza Landing Page](features/milestone-16-0-staza-landing-page/README.md)
  — add an isolated public landing page at `/` while preserving the existing
  authenticated app under `/app` and `/sign-in`.
- [Multi Clip creation](features/multi-clip-creation/README.md) — select detected
  Coin passages and combine them into one chronological highlight video.
- [Persistent activities player state v1](features/persistent-activities-player-state-v1/README.md)
  — persist compact activity/event history and single-player XP in PostgreSQL
  with transaction-safe exactly-once progression.
- [Progression V1](features/progression-v1/README.md) — make each completed ride
  contribute XP toward a derived player level without adding persistence or rewards.
- [Renderer resilience output validation](features/renderer-resilience-output-validation/README.md)
  — harden highlight rendering with media inspection, timestamp-safe concat, and
  final MP4 validation.
- [Robust sync](features/robust-sync/README.md) — validate the existing FIT/GPS5
  synchronization against manually verified reference events.
- [Route-Relevant World Query V1](features/route-relevant-world-query-v1/README.md)
  — cheaply limit the configured world to the padded geographic region around an
  activity route before existing precise collectible detection and presentation.
- [Shared Staza Map Foundation](features/shared-staza-map-foundation/README.md)
  — unify World and Activity Detail on one MapLibre Staza map foundation and
  rebuild the Ride Detail replay natively on shared basemap, theme, and layers.
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
- [SMTP auth email delivery](features/smtp-auth-email-delivery/README.md)
  — send authentication codes and security notifications by real email via
  nodemailer SMTP against the existing mail server in production.
- [Synchronization diagnostics](features/synchronization-diagnostics/README.md)
  — make FIT/GPS5 synchronization failures explicit and operationally visible.
- [World Collectible Domain Model V1](features/world-collectible-domain-model-v1/README.md)
  — normalize legacy Coin configuration into reusable world Collectibles with
  canonical event relationships and shared replay/HUD presentation metadata.

## World architecture

The World screen is a **browse read model**, not the route-relevant candidate
query used while processing an activity. `GET /api/world` combines the complete
configured collectible catalog with the current player's persisted
`collectible_collected` source IDs. A collectible is Found only when such an
event exists; geographic proximity to a recorded route never establishes
discovery.

The current configured catalog is the World scope. Its catalog-intersected,
distinct player discoveries derive discovered, rare, epic, and remaining counts.
The UI filters one loaded snapshot client-side for All, Found, Unfound, Rare,
and Epic; rarity filters intentionally include both found and unfound items.

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
npm run seed:collectibles
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
- **Collectibles:** The curated catalog lives in the PostgreSQL `collectibles`
  table. `fixtures/world-v1-seed.json` is the default seed document: run
  `npm run seed:collectibles` to upsert its collectibles by `id` and publish its
  curated quests (seeding never deletes rows). Pass a file explicitly, for
  example `npm run seed:collectibles -- fixtures/other-world.json`, or set
  `COLLECTIBLE_SEED_FILE` to change the default. A seed document holds a
  `collectibles` list, an optional `curator`, and optional `quests`; a plain
  nonempty list of Collectibles is also accepted. Legacy entries with `id`,
  `latitude`, `longitude`, `radius_m`, and `value` normalize to a `coin` named
  after its ID. Rich entries may additionally set a nonblank `name`, `type`
  (`coin` or `landmark`), optional `rarity` (`common`, `rare`, or `epic`), and
  optional nonblank `description`. Coordinates must be finite and in range,
  `radius_m` must be positive, `value` must be finite and nonnegative, and ids
  must be unique.
- **quäldich pass catalog:** `npm run import:quaeldich` imports cycling mountain
  passes from the official quäldich Pässelexikon GeoJSON
  (`https://www.quaeldich.de/common/js/paesse_geojson.php?license=odbl`, licensed
  **ODbL 1.0**) into the same `collectibles` table as `mountain_pass` records.
  Add `-- --dry-run` to download, validate, and report expected changes without
  writing. The importer is manual/on-demand (no scheduled sync) and is never on
  the runtime World request path. It is idempotent: records use the stable
  identity `quaeldich:<TextID>` (`source_type = quaeldich`,
  `source_external_id = TextID`), so re-running updates existing rows instead of
  creating duplicates or rotating ids. Only the licensed elementary fields are
  imported — pass name, coordinates, elevation (`elevation_m`), and TextID;
  gameplay `value` (XP) is derived from elevation via one centralized helper
  (`mountainPassValueFromElevation`), and rarity is a neutral `common`.
  Attribution to **quäldich.de** (with a per-pass deeplink
  `https://www.quaeldich.de/paesse/<TextID>/`) is persisted and shown in the
  World collectible detail. The importer reports created/updated/unchanged/
  rejected counts, possible proximity/name duplicates (never auto-merged), and
  records missing from the current upstream (never auto-deleted). Ascent,
  popularity, QDH, surface, and other website content are intentionally **not**
  imported; do not replace this GeoJSON import with website scraping without a
  separate licensing review. See
  [Milestone 15.4](features/milestone-15-4-quaeldich-pass-import/README.md).

The app derives the event in three steps:

```text
Collectible coordinates → FIT track crossing time → GPS5-clock-aligned video second
```

Each detected Collectible is represented downstream as a
`collectible_collected` `GameEvent` containing canonical `sourceId`, compact
event-time name/type/optional-rarity presentation metadata, value, coordinates,
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
  progress together with player-scoped lifetime distance, unique collectible and
  rare-or-better totals, canonical nearby level thresholds, and the four newest
  persisted Ride summaries for the Progress Desktop.
