# milestone-15-4-quaeldich-pass-import

## Goal

Populate the Staza World with a large, high-quality curated seed of cycling-relevant
mountain passes imported from the official quäldich Pässelexikon GeoJSON dataset. The
importer is a repository-owned, manual/on-demand maintenance script — never a runtime
web dependency. Imported passes flow through the existing canonical collectibles →
World API → MapLibre pipeline, with source identity and attribution preserved
throughout.

## Source & license

- Official machine-readable GeoJSON:
  `https://www.quaeldich.de/common/js/paesse_geojson.php?license=odbl`
- License: **ODbL 1.0**. Required usage-proximate attribution: **quäldich.de**.
- Confirmed payload shape: a `FeatureCollection` of Point features (9,205 global
  records). Each feature exposes exactly:
  - `geometry.coordinates` = `[longitude, latitude]`
  - `properties.TextID` (stable slug, e.g. `col-agnel`)
  - `properties.name`
  - `properties.ele` (elevation, metres)
- Deeplink format (verified HTTP 200): `https://www.quaeldich.de/paesse/<TextID>/`.

Only the fields above are imported. We do **not** scrape or import HTML pages, climb
descriptions, popularity/QDH scores, ascent/route/profile data, images, ratings,
user-generated text, Schotter/surface, gradient, or any list-page filter attributes.
Replacing this GeoJSON import with website scraping requires a separate licensing
review.

## Decisions

- **Scope:** import the **entire global catalog** (all features). No Germany filtering
  — the payload has no country field and the user chose to import all.
- **Canonical category:** add `mountain_pass` as a `collectible_type` value.
- **Elevation:** persist `properties.ele` as `elevation_m` (validated numeric,
  plausible range, nullable only if source is missing/invalid).
- **XP / value:** persist source elevation separately as `elevation_m`; do **not** set
  `value = elevation_m`. Derive the gameplay value from elevation through one
  centralized deterministic helper `mountainPassValueFromElevation(elevation_m)` using
  a bounded stepped curve so higher passes reward more XP without extreme values.
  Initial tiers: `<500 m → 100`, `500–999 → 150`, `1000–1499 → 250`,
  `1500–1999 → 400`, `2000+ → 600`. Kept isolated so it can be rebalanced later without
  changing imported source data. Elevation missing/invalid → lowest tier default.
- **Rarity:** neutral default `common` (never derived from altitude).
- **Collection radius:** centralized `MOUNTAIN_PASS_DEFAULT_RADIUS_M = 100`. Existing
  outside→inside trigger semantics unchanged.
- **Identity:** source-derived stable id `quaeldich:<TextID>`, with
  `source_type = "quaeldich"`, `source_external_id = <TextID>`. Uniqueness enforced on
  `(source_type, source_external_id)`. Ids never rotate across re-imports.
- **Attribution metadata:** `source_url = https://www.quaeldich.de/paesse/<TextID>/`,
  `source_attribution = "quäldich.de"`.
- **Status:** imported directly as `published`; source metadata retained so records can
  later be archived. No human-review queue.

## Scope

In scope: additive migration, importer modules + CLI, dry-run, idempotent upsert,
import report, source/elevation surfaced through domain + repository + World feature
normalization, subtle clickable World attribution, test fixture and tests, docs.

Out of scope: HTML scraping, ascent/popularity/QDH/surface data, altitude-based rarity,
retroactive Activity reprocessing, OSM/Wikidata/Wikipedia enrichment, viewpoint/peak
import, scheduled/automatic refresh, PostGIS, regions, fog of war, route generation,
segment challenges, speed gates, descents, Germany point-in-polygon filtering.

## Migration (`012_collectible_sources`, additive only)

- `elevation_m DOUBLE PRECISION NULL` with plausible-range check.
- `source_type TEXT NULL`, `source_external_id TEXT NULL`, `source_url TEXT NULL`,
  `source_attribution TEXT NULL`.
- `status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','archived'))`.
- Partial unique index `collectibles_source_identity_unique (source_type,
  source_external_id) WHERE source_type IS NOT NULL`.
- Relax the type check to `collectible_type IN ('coin','landmark','mountain_pass')`.

All columns nullable/defaulted so the existing curated seed and quests are untouched.

## Field mapping

| quäldich            | Staza                                            |
| ------------------- | ------------------------------------------------ |
| `properties.name`   | `name`                                           |
| `coordinates[1/0]`  | `latitude` / `longitude`                         |
| `properties.ele`    | `elevation_m`; `value` via `mountainPassValueFromElevation` |
| `properties.TextID` | `source_external_id`, `id = quaeldich:<TextID>`  |
| —                   | `collectible_type = mountain_pass`               |
| —                   | `rarity = common`, `status = published`          |
| —                   | `radius_meters = MOUNTAIN_PASS_DEFAULT_RADIUS_M` |
| —                   | `source_type = quaeldich`                        |
| —                   | `source_url = .../paesse/<TextID>/`              |
| —                   | `source_attribution = quäldich.de`               |

## Module structure

```text
src/quaeldich/fetchGeoJson.ts   -> fetchQuaeldichGeoJson()      (network)
src/quaeldich/normalize.ts      -> normalizeQuaeldichFeature()  (pure)
src/quaeldich/import.ts         -> importQuaeldichPasses()      (upsert + report)
src/persistence/importQuaeldichPasses.ts -> CLI entry (--dry-run)
```

Fetch / normalize / persist are separated so tests validate logic without network
access. `QUAELDICH_GEOJSON_URL` is centralized in config.

## npm commands

- `npm run import:quaeldich`
- `npm run import:quaeldich -- --dry-run` (download + validate + normalize + report,
  no DB writes)

Manual/on-demand only — no cron, webhooks, or scheduled sync.

## Import behaviour

1. Download GeoJSON; validate basic structure; validate + normalize each feature;
   reject malformed records safely (never import malformed coordinates).
2. Idempotent upsert on stable id / source identity: re-running produces no duplicates
   and preserves collectible ids (protecting GameEvent and Quest references).
3. Report: source URL, fetched count, normalized count, created / updated / unchanged /
   rejected, possible proximity/name duplicates against existing collectibles (report
   only — no auto-merge), records missing from current upstream (report only — no
   auto-delete), and dry-run status. Show aggregate totals plus a small sample of
   problematic records; never dump thousands of rows.
4. Upstream metadata changes (name/coords/elevation) update the canonical row only.
   Historical GameEvent snapshots remain untouched; no XP re-award; no retroactive
   collection detection.

## World / UI

- Surface `elevation_m` and `source_*` through the domain `Collectible`, the
  collectible repository `SELECT`/mapper/upsert, and the shared collectible GeoJSON
  feature properties (`category` already carries `collectible_type`).
- Imported passes appear via the existing bbox/viewport World query and native
  MapLibre layers — no separate quäldich layer.
- Collectible detail shows a subtle, clickable `Source: quäldich.de` link
  (`source_url`) when present. Existing OpenFreeMap/OpenStreetMap basemap attribution
  is preserved and untouched.

## Test fixture & tests

- `fixtures/quaeldich-sample.geojson`: a handful of records covering normal import,
  update, unchanged, invalid coordinate, missing TextID, duplicate TextID, and
  elevation parsing. Tests never hit the live site.
- Tests: normalization (coord order, elevation, category, source identity/attribution),
  idempotency (create / unchanged / name-update / no duplicate ids), validation
  (malformed geometry, invalid lat/lon, missing/duplicate source identity), persistence
  (source uniqueness, repository availability, Quest FK integrity, historical event
  snapshots unaffected), and World (bbox appearance, visited state, category exposure,
  attribution available to detail UI).

## Acceptance criteria

- Dry-run reports expected changes without modifying the database.
- First real import creates the catalog; a second identical run reports all unchanged
  with zero duplicates and stable ids.
- Imported passes appear in the World bbox query with correct name/elevation, category
  `mountain_pass`, and a clickable quäldich source link; visited/unvisited works.
- Import awards no XP and does not reprocess historical activities.
- Existing curated World items and Quests remain intact; no console errors; full test
  suite passes.

## Validation

1. Run `npm run import:quaeldich -- --dry-run`; inspect the report.
2. Run the real import; run it again and confirm idempotency (all unchanged).
3. Open World, navigate to an area with known passes, verify appearance, detail
   (name/elevation/source link), and visited state.
4. Verify no XP awarded by import, curated items + Quests intact, zero console errors.
5. Run the full test suite.

## Risks

Low: migration is additive/nullable; `quaeldich:*` ids cannot collide with the curated
seed; upsert never rotates ids; historical `activity_events` snapshots and
`quest_collectibles` FKs are untouched; no retroactive activity reprocessing.
