# Milestone 15 — Staza World v1

> **Update (superseded):** The curated external route links / Komoot provider
> described below were removed from the product. The quest "View route" CTA is now a
> "Create route" placeholder marked Coming Soon. See
> [`features/coming-soon`](../coming-soon/README.md). Sections mentioning external
> routes, the `quest_external_routes` table, or Komoot are retained for historical
> context only and no longer reflect the codebase.
>
> **Quest workflow update:** The user-authored collectible-only quest workflow
> documented below has been replaced by curated `QuestTemplate`s, bbox-local
> recommendations, and explicitly started persistent instances. See
> [`features/default-quests`](../default-quests/README.md) for the current model.

## Goal

Build the first real Staza World experience around a simple product idea:

> Open Staza, see what is worth discovering nearby, see what you already visited,
> and choose something to explore next.

The loop the feature must support:

```text
OPEN WORLD → DISCOVER PLACES / QUESTS → CHOOSE SOMETHING → GO OUTSIDE
→ COMPLETE COLLECTIBLES → RETURN → SEE PROGRESS
```

World v1 is deliberately small, curated, understandable, and useful.

## Scope

Implemented in this milestone:

1. A real interactive MapLibre map on a real geographic basemap.
2. Curated collectibles rendered on that map.
3. Visited / unvisited state derived from canonical player history.
4. Quests relevant to the current map viewport.
5. Quest progress derived from canonical collectible history.
6. Curated external route links (initial provider: Komoot).
7. Creating a Quest from an existing completed Activity.
8. Migration of the curated collectible catalog into PostgreSQL.

## Out of scope

Explicitly not implemented here: Fog of War; regions, region progress, and region
unlocks; PostGIS; self-hosted tile infrastructure or a PMTiles pipeline; route
generation and routing algorithms; turn-by-turn navigation; Python, OSM, or
Wikidata POI import; automatic curation, scoring, or publishing; a public quest
marketplace; ratings; comments; social feed; followers; moderation workflows;
achievements; Strava or Garmin integration; GPX export; scraping external
provider pages.

## Decisions

Decisions confirmed while refining the plan:

| Decision | Choice |
|---|---|
| Basemap provider | OpenFreeMap Liberty (`https://tiles.openfreemap.org/styles/liberty`) — keyless, real roads/paths/water/forest/labels — behind an env-configurable abstraction. |
| Collectible catalog source of truth | Migrated into a PostgreSQL `collectibles` table in this milestone. The curated seed document `fixtures/world-v1-seed.json` is the import source. |
| World header `Discovered X / Y` counter | Remains a global lifetime counter. Viewport-scoped stats are shown under the map. |
| Map renderer | MapLibre GL JS, vendored and served from the app origin (CSP keeps `script-src 'self'`). |
| Geo querying | Plain latitude/longitude bounding-box queries with B-tree indexes. No PostGIS. |
| Quest progress | Derived at read time by intersecting quest collectible ids with player collected ids. No duplicated completion state. |

## Current implementation audit

### Frontend — `public/components/world-page.js`

| Piece | Classification | Notes |
|---|---|---|
| `mountWorldPage` (fetch `/api/world`, render loop) | needs adaptation | Becomes viewport-driven and re-queries on map `moveend`. |
| `worldFilters`, `filteredWorldCollectibles`, `WorldFilterTabs` | reusable | Filter set already matches All/Found/Unfound/Rare/Epic and filtering is already centralized in a pure function. |
| `worldMarkerPositions` (min/max lat-lon → percentage) | remove | Fake projection; MapLibre owns projection. Its unit test is replaced. |
| `WorldMap` and `.world-map-terrain` | replace | Static mock geometry. |
| `WorldMarker` | adapt | Markup, `CollectibleIcon`, and rarity/found/selected classes carry over to MapLibre DOM markers; `--world-x` / `--world-y` are dropped. |
| `WorldLegend`, `WorldStats`, `WorldPage` header | reusable | Stats gain a viewport-scoped variant alongside the global counter. |
| `visibility: "visible" \| "hidden"` | future placeholder | Fog-of-war hook. Left untouched and never set to `hidden`. |

### Backend

| Piece | Classification | Notes |
|---|---|---|
| `GET /api/world` (`src/server.ts`) | adapt | Gains an optional `bbox` parameter; the no-bbox contract is preserved. |
| `src/world.ts` `createWorldSnapshot` | reusable | Already composes catalog plus player history into `found`. Canonical visited derivation. |
| `src/worldQuery.ts` (`GeoBounds`, `padGeoBounds`, `getRelevantCollectibles`) | reusable / extend | Gains a `filterCollectiblesByBounds` sibling. Route-relevance logic is untouched. |
| `src/coin.ts` `readCollectibles` | adapt | Becomes the validating parser for the seed importer instead of a request-path dependency. |
| `ActivityRepository.listDiscoveredCollectibleSourceIds` | reusable | Player-scoped `DISTINCT source_id` over `activity_events`. Canonical visited truth. |
| `requirePlayer`, `requireCsrf`, session handling | reusable | `request.user.playerId` is always server-derived. |

Not present today: map library, quests, routes, geo tables, create-from-activity flow.

### Collectible data and persistence today

- Catalog: `fixtures/world-v1-seed.json` (path via `COLLECTIBLE_SEED_FILE`), validated by `readCollectibles` into
  `Collectible { id, name, type, latitude, longitude, radiusMeters, value, rarity?, description? }`.
- Player history: `activity_events (activity_id, source_id, …)` with
  `UNIQUE (activity_id, source_id)`, joined to `activities.player_id`.
- Collection semantics: first outside-to-inside crossing in `src/activity.ts`, unchanged.

### Existing APIs reused

`GET /api/world`, `GET /api/activities`, `GET /api/activities/:id` (returns
`PersistedActivity` including `events[]` and `replay.activity.route`),
`GET /api/player/progress`, `GET /api/auth/session`.

## Implementation plan

### 1. Collectible catalog in PostgreSQL

Migration `010_collectibles` creates the catalog table:

```sql
CREATE TABLE collectibles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  collectible_type TEXT NOT NULL CHECK (collectible_type IN ('coin', 'landmark')),
  rarity TEXT CHECK (rarity IS NULL OR rarity IN ('common', 'rare', 'epic')),
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  radius_meters DOUBLE PRECISION NOT NULL CHECK (radius_meters > 0),
  value DOUBLE PRECISION NOT NULL CHECK (value >= 0),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX collectibles_bbox_index ON collectibles (latitude, longitude);
```

- `src/persistence/collectibleRepository.ts` provides `listAll()`,
  `listWithinBounds(bounds, limit)`, `listByIds(ids)`, and `upsertMany(collectibles)`.
- `src/coin.ts` keeps its validation logic and becomes the parser used by a new
  idempotent seed command `npm run seed:collectibles` (`src/persistence/seedCollectibles.ts`),
  which reads `COLLECTIBLE_SEED_FILE` and upserts collectibles by `id`; collectible
  rows are never deleted by seeding.
  The command accepts an explicit file argument
  (`npm run seed:collectibles -- fixtures/world-v1-seed.json`) and reads either a
  plain collectible array or a seed document of the form
  `{ "curator": { "displayName": … }, "collectibles": [ … ], "quests": [ … ], "removeQuests": [ … ] }`.
  Seed quests are owned by a curator player resolved by display name and are
  reconciled by title, so reseeding updates them in place instead of duplicating them.
  The explicit `removeQuests` list deletes only quests with those titles owned by
  that curator.
- `activity_events.source_id` intentionally keeps no foreign key to `collectibles`:
  historical gameplay must survive catalog edits.
- Request paths (`/api/world`, activity processing in `src/server.ts`) read the
  catalog from the repository instead of the file. Activity processing continues to
  narrow the catalog with `getRelevantCollectibles` using route bounds.

### 2. MapLibre integration

- Add the `maplibre-gl` dependency and vendor it:
  `app.use("/shared/maplibre", express.static(path.resolve("node_modules/maplibre-gl/dist")))`,
  mirroring the existing `/shared/webauthn` pattern. No CDN, so `script-src` stays `'self'`.
- `public/components/world/world-map.js` wraps `maplibregl.Map` and exposes
  `onViewportChange(bbox)`, `setCollectibles()`, `setSelected()`, `setRoute()`, and
  `locate()`. It contains no Staza business logic.
- CSP changes in the helmet block: add `workerSrc: ["'self'", "blob:"]`,
  `childSrc: ["blob:"]`, and append the configured basemap origin to `connectSrc`
  and `imgSrc`. The origin is derived from config, never hardcoded.
  `styleSrcAttr: 'unsafe-inline'` already exists and covers marker inline styles.
- Collectibles render as DOM-element markers so the existing `CollectibleIcon` SVGs
  and rarity classes carry over.
- MapLibre is loaded with a dynamic `import()` on the World screen only.

### 3. Basemap abstraction

- `src/basemap.ts` exposes `getBasemapConfig()` returning
  `{ styleUrl, attribution, origins }`.
- Config keys: `BASEMAP_STYLE_URL` (default
  `https://tiles.openfreemap.org/styles/liberty`) and `BASEMAP_ATTRIBUTION`.
- `GET /api/world/basemap` serves that config to the client so the tile provider can
  be replaced by environment change alone. World logic never names a provider.
- The basemap supplies geographic context only. Collectibles, quests, player
  progress, and route state are never encoded into it.

### 4. Viewport-driven World query

- `GET /api/world?bbox=west,south,east,north&limit=` behind `requirePlayer`.
- Validation: four finite numbers, latitude within `[-90, 90]`, longitude within
  `[-180, 180]`, `south <= north`. Invalid input raises `UserInputError` (400).
  Antimeridian-crossing bounds are normalized into two longitude ranges.
- New pure helper `filterCollectiblesByBounds` in `src/worldQuery.ts` mirrors the SQL
  predicate for unit testing; the repository performs the bounded query.
- Results are capped by `WORLD_VIEWPORT_LIMIT` (default 300), retaining those closest
  to the viewport centre, and the response sets `truncated: true` when capped.
- Response shape: `{ collectibles, stats, quests, truncated }`, where `stats` is
  viewport-scoped.
- Omitting `bbox` preserves the current global behavior, so `/api/player/profile`
  and the global header counter are unaffected.
- Filters apply to Staza content only and never to the basemap.

### 5. Quest, route, and external route schema

Migration `011_quests`:

```sql
CREATE TABLE quests (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_by_player_id UUID NOT NULL REFERENCES players(id),
  source_activity_id TEXT REFERENCES activities(id) ON DELETE SET NULL,
  center_latitude DOUBLE PRECISION NOT NULL,
  center_longitude DOUBLE PRECISION NOT NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX quests_published_bbox_index
  ON quests (center_latitude, center_longitude) WHERE status = 'published';
CREATE INDEX quests_creator_index
  ON quests (created_by_player_id, created_at DESC);

CREATE TABLE quest_collectibles (
  quest_id UUID NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  collectible_id TEXT NOT NULL REFERENCES collectibles(id) ON DELETE RESTRICT,
  order_index INTEGER,
  PRIMARY KEY (quest_id, collectible_id)
);

CREATE TABLE quest_routes (
  quest_id UUID PRIMARY KEY REFERENCES quests(id) ON DELETE CASCADE,
  source_activity_id TEXT REFERENCES activities(id) ON DELETE SET NULL,
  geometry JSONB NOT NULL,
  distance_meters DOUBLE PRECISION CHECK (distance_meters IS NULL OR distance_meters >= 0),
  activity_type TEXT CHECK (activity_type IN ('cycling', 'running', 'hiking', 'walking', 'unknown')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE quest_external_routes (
  id UUID PRIMARY KEY,
  quest_id UUID NOT NULL UNIQUE REFERENCES quests(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('komoot')),
  url TEXT NOT NULL,
  title TEXT,
  distance_meters DOUBLE PRECISION CHECK (distance_meters IS NULL OR distance_meters >= 0),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Because the catalog now lives in PostgreSQL, `quest_collectibles.collectible_id`
carries a real foreign key with `ON DELETE RESTRICT`, so a curated collectible
referenced by a quest cannot be removed silently.

`center_latitude` and `center_longitude` are recomputed server-side on every write
from the quest's collectibles, falling back to the route centroid. They are never
accepted from the client.

### 6. Quest progress

`src/quest.ts` exposes a pure `deriveQuestProgress(questCollectibleIds, collectedIds)`
returning `{ collected, total, ratio, complete }`. Progress is computed at read time
by intersecting quest collectible ids with
`listDiscoveredCollectibleSourceIds(playerId)`. There is no completion column and no
per-player quest row. A quest is complete when every quest collectible has been
collected by that player.

### 7. Quests nearby and quest presentation

- The World response includes quests whose centre falls inside the current viewport,
  using the map viewport rather than the device GPS position, so users can explore
  future destinations. Geolocation permission is never required.
- Quest cards show title, short description, progress (`4 / 8 visited`, `50%`),
  collectible count, completion state, and whether a route is available.
- Quest detail shows title, description, progress, the collectible list with
  per-collectible visited state, the route when available, the external route CTA
  when a valid external route exists, and subtle creator attribution.
- Selecting a quest draws its route geometry on the map in a restrained style,
  together with its collectibles and their visited state. Basemap context stays visible.
- Owners can delete draft or published quests from the detail panel after confirming
  permanent deletion. The existing owner-only delete API removes the quest for all
  users; World clears its detail, route, and quest-only markers and refreshes nearby quests.
- Published user-created quests appear exactly like curated Staza quests. There is no
  separate "official versus user" mode, no ratings, and no popularity ranking.

### 8. Activity to Quest flow

1. `GET /api/activities/:id/quest-draft` (owner only) returns a suggested, entirely
   unpersisted draft: `{ title, description, activityType, distance, route, collectibles }`.
   The title is suggested from the activity type and date. Suggested collectibles are
   the activity's `activity_events.source_id` values intersected with the catalog, and
   the set is editable before publishing.
2. `POST /api/quests` accepts `{ title, description?, sourceActivityId?, collectibleIds, externalRoute? }`
   and creates the quest with `status = 'draft'`. When `sourceActivityId` is present,
   the same transaction writes a `quest_routes` snapshot derived from
   `replay_snapshot.activity.route`, simplified with Douglas–Peucker and capped at
   roughly 2000 points, stored as a GeoJSON `LineString`.
3. `PATCH /api/quests/:id` edits title, description, collectible selection, and the
   external route link. `POST /api/quests/:id/publish` and
   `POST /api/quests/:id/unpublish` toggle visibility.
4. The route snapshot is a copy, so a published quest never depends on mutable
   activity runtime state. Only the `source_activity_id` reference is nulled if the
   source activity disappears.
5. Guarantees enforced by tests: quest creation performs no writes to `activities`,
   `activity_events`, or `players`; no XP is re-awarded; no GameEvents are created or
   duplicated; the source Activity remains unchanged and cannot be edited through any
   quest endpoint.

### 9. Security, ownership, and visibility

- Every quest endpoint requires an authenticated session; mutations additionally
  require CSRF verification.
- Creator identity is always `request.user.playerId`. A `player_id` is never accepted
  from the client on any endpoint.
- Edit, publish, and delete operations are scoped with
  `WHERE id = $1 AND created_by_player_id = $2`; zero affected rows returns 404 so
  quest existence is not leaked.
- Quest-from-activity verifies `activities.player_id = playerId` before reading the
  replay snapshot.
- Visibility is `draft` (creator only) or `published` (all authenticated users).
  World queries filter `status = 'published' OR created_by_player_id = $me`.
- Creator attribution uses `players.display_name` only. Authentication email is never
  exposed as public creator identity.
- External route URLs must be `https:`, must match the provider host allowlist
  (`komoot.com` and its `www` host), and must be at most 2048 characters. Malformed
  URLs are rejected with 400. Links render with `target="_blank"` and
  `rel="noopener noreferrer"`. Provider pages are never scraped and metadata is never
  assumed unless explicitly stored.

### 10. Frontend structure

```text
public/components/world-page.js                 orchestrator: state, fetching, filters, selection
public/components/world/world-map.js            MapLibre wrapper, no domain logic
public/components/world/world-markers.js        marker element plus rarity and visited styling
public/components/world/quest-list.js           quest card and nearby list, pure
public/components/world/quest-detail.js         quest panel, pure
public/components/world/collectible-detail.js   collectible panel, pure
public/components/world/quest-editor.js         draft review, edit, and publish form
public/styles/world.css                         new; mock-map rules leave app-shell.css
```

World state is `{ bbox, collectibles, quests, activeFilter, selection }` where
selection is `{ kind: 'collectible' | 'quest', id }`. Viewport changes are debounced
at 250 ms and in-flight requests are superseded by newer ones.

Collectible detail shows name, type, rarity, value, visited state, visit date when
available from history, and related quests when cheaply derivable. No descriptions or
metadata are fabricated.

Markers communicate unvisited, visited, and selected states, with restrained rarity
accents and the Staza gold accent where appropriate. Icons only, no text labels on the
map. Empty areas show "Nothing curated here yet." and never fabricate collectibles.

A `Locate me` control uses `navigator.geolocation`. Denial leaves World fully usable
by pan and zoom, and precise location is never persisted.

### 11. Activity Detail changes

A `CREATE QUEST` action is added to the activity detail header, shown only when the
activity has a usable replay route. It opens the quest editor prefilled from
`/api/activities/:id/quest-draft`. Existing tabs, replay, video, and near-miss
behavior are untouched.

### 12. Files to add

`src/basemap.ts`, `src/quest.ts`, `src/quest.test.ts`,
`src/persistence/collectibleRepository.ts`,
`src/persistence/collectibleRepository.test.ts`,
`src/persistence/seedCollectibles.ts`, `src/persistence/questRepository.ts`,
`src/persistence/questRepository.test.ts`, `src/worldViewport.test.ts`, the
`public/components/world/*.js` components with their `.test.js` siblings,
`public/styles/world.css`, and `fixtures/world-v1-seed.json` holding a curated test
area of roughly 40 collectibles, 4 quests, and 2 external route links.

### 13. Files to modify

`package.json` (`maplibre-gl` dependency, `seed:collectibles` script), `src/config.ts`
(`basemapStyleUrl`, `basemapAttribution`, `worldViewportLimit`), `src/domain.ts`
(quest, quest route, external route, and quest progress types), `src/coin.ts`
(parser repurposed for seeding), `src/worldQuery.ts` (`filterCollectiblesByBounds`),
`src/world.ts` (viewport-scoped snapshot), `src/persistence/migrations.ts`
(migrations `010` and `011`), `src/server.ts` (CSP, `/shared/maplibre`, catalog reads
from the repository, `bbox` support, `/api/world/basemap`, quest endpoints,
quest-draft endpoint), `public/components/world-page.js`,
`public/components/world-page.test.js`, `public/components/activity-detail-page.js`,
`public/styles/app-shell.css` (remove mock-map rules), `public/index.html` (MapLibre
and World stylesheets), `README.md`, and `.env.example`.

### 14. Migrations

Two forward-only migrations are appended to the `migrations` array:
`010_collectibles` and `011_quests`. No applied migration is edited, no column is
dropped, and PostGIS is not introduced. Existing schema is inspected before any
additive change.

## Acceptance criteria

- World renders a real MapLibre basemap with roads, paths, water, forests, towns, and
  labels, and Staza content is overlaid on top of it.
- Panning or zooming the map refreshes collectibles and quests for the new viewport
  without loading the global world into the browser.
- Collectibles show correct visited and unvisited state derived solely from the
  authenticated player's `activity_events` history.
- All, Found, Unfound, Rare, and Epic filters affect Staza content only.
- Selecting a collectible opens detail with name, type, rarity, value, and visited state.
- Quests near the current viewport are listed with progress derived from canonical
  collectible history, and a quest becomes complete when all its collectibles are collected.
- Selecting a quest shows its detail and draws its route on the map, with an external
  route CTA when a valid external route exists.
- An activity owner can create a draft quest from a completed activity, edit its
  title, description, and collectible selection, add an external route link, and
  publish it.
- A second user discovers the published quest, sees it with their own independent
  progress, and cannot see other users' drafts.
- Creating a quest from an activity leaves the source activity, its events, and player
  XP byte-identical.
- Areas without curated content show an empty state rather than looking broken.

## Validation

### Automated tests

World:
- Viewport query returns only in-bounds collectibles.
- Malformed or out-of-range bbox values are rejected.
- An empty viewport returns an empty result rather than an error.
- Visited state belongs to the authenticated player, with cross-user isolation.
- All five filters behave correctly.
- The viewport cap is enforced and reports `truncated`.

Catalog migration:
- Seeding from `COLLECTIBLE_SEED_FILE` is idempotent and upserts by id.
- Invalid catalog entries are rejected by the existing validation rules.
- Historical `activity_events` remain readable for collectibles removed from the catalog.

Quest:
- Create a draft quest and add collectibles.
- An unknown collectible id is rejected.
- Publish a quest and confirm it appears in another user's World viewport.
- A draft quest is not visible to other users.
- Quest progress derives from player collectible history.
- A quest becomes complete when all its collectibles are collected.
- A non-owner receives 404 on edit and publish.

Activity to Quest:
- Only the owner can create a quest from an activity.
- The source activity and its events are unchanged afterwards.
- No XP is re-awarded and `players.total_xp` is unchanged.
- No duplicate GameEvents are created.
- The route snapshot geometry, distance, and activity type are correct.
- Collectible suggestions derive from activity events.
- The published quest can be viewed by another user.

External route:
- Provider and URL persist correctly.
- Malformed, non-HTTPS, and non-allowlisted URLs are rejected.
- The route CTA renders only when a valid route exists.

PostgreSQL-backed suites are added to the `test:persistence` script and run with
`--no-file-parallelism`.

### Manual validation

Using a curated test area of roughly 40 collectibles, 4 quests, and 2 route links:
open World; pan and zoom; confirm the real map; see curated collectibles; distinguish
visited from unvisited; apply the Found, Unfound, Rare, and Epic filters; select a
collectible; review nearby quests; open a quest; check progress; view the quest route;
open the external Komoot route; complete an activity; create a quest from it; edit
title, description, and collectibles; publish; sign in as a second user; find the
published quest; and confirm that the second user's progress is independent.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| CSP relaxation for map tiles | Only `worker-src blob:` plus one explicit basemap origin in `connect-src` and `img-src`. `script-src` stays `'self'` because MapLibre is vendored. |
| Catalog move from file to database breaks activity processing | Processing reads the catalog through the repository while keeping `getRelevantCollectibles` route narrowing; seeding is idempotent and verified before the request path switches. |
| Catalog rows referenced by quests being deleted | `quest_collectibles` uses `ON DELETE RESTRICT`; seeding never deletes rows. |
| Historical events orphaned by catalog edits | `activity_events.source_id` deliberately has no foreign key, so gameplay history survives catalog changes. |
| `/api/world` shape change affecting the profile endpoint | The no-bbox path keeps the current contract and the profile stats path is untouched. |
| Accidental XP or event duplication through quest creation | Quest writes never touch `activities`, `activity_events`, or `players`, and this is asserted by tests. |
| Removal of `worldMarkerPositions` | It is only consumed by World; its test is replaced by bounding-box tests. |
| MapLibre bundle weight | Loaded through a dynamic import on the World screen only. |
| Geolocation denial | World remains fully functional via pan and zoom, and location is not persisted. |
| Unbounded marker rendering | Viewport querying plus an explicit server-side cap, without a premature vector tile backend. |
