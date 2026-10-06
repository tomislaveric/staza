# milestone-15-6-automated-osm-wikidata-collectible-pipeline

## Goal

Build a conservative, reproducible offline pipeline that discovers high-quality
real-world Staza collectibles from OpenStreetMap (OSM) and enriches or validates
them with Wikidata. Prefer precision over recall: uncertain, inaccessible,
unnamed, duplicate, or weakly matched locations must not flood the published
World.

## Scope

- Initial geography: Germany, with country selection designed to extend later.
- Automatically discovered categories: `viewpoint`, `peak`, `castle`, and
  `waterfall`.
- Mountain passes remain owned by the separate quäldich importer. Do not import
  OSM mountain passes or replace the quäldich catalog.
- OSM extraction, Wikidata requests, scoring, and import run as repository
  maintenance scripts. Normal Staza World requests never depend on either
  external service.
- No routing engine, GPX, popularity scraping, machine-learning ranking, ratings,
  admin review UI, global OSM import, or retroactive activity processing.

## Current model and compatibility

The canonical catalog is the existing PostgreSQL `collectibles` table. The
current `Collectible` model has a gameplay `type` (`coin`, `landmark`, or
`mountain_pass`), optional rarity, radius, value, elevation, status, and source
identity/URL/attribution. Source identities are unique on
`(source_type, source_external_id)`. There is no current semantic-tag field;
map feature `category` currently comes from `type`.

`GameEvent` snapshots preserve name, type, rarity, value, and coordinates, and
replay snapshots preserve the activity result. Imports must not modify or
regenerate historical events, award XP, rerun activities, or rotate collectible
IDs. Existing seed data, quests, quäldich attribution, and basemap attribution
must remain intact.

## Decisions

### OSM source and ingestion (revised v1 plan; not yet implemented)

- Call the Overpass API directly from the repository importer, not through
  Overpass Turbo. Do not download a Germany PBF in v1. Keep the OSM source
  behind a small ingestion interface that emits the existing normalized
  `OSMRecord` stream and provenance; a future PBF adapter must not change
  normalization, Wikidata enrichment, scoring, deduplication, or persistence.
- Request nodes, ways, and relations matching only these exact classes:
  - `tourism=viewpoint`
  - `natural=peak`
  - `historic=castle`
  - `waterway=waterfall`
- Use deterministic, bounded geographic tiles covering German federal states
  (and a Germany boundary filter), subdividing large or slow regions instead
  of issuing one country-wide query. Fetch the four classes together per tile;
  deduplicate tile overlaps by OSM object type and ID. Do not broaden to
  generic `tourism=*`, `natural=*`, or `historic=*`.
- Request sufficient geometry to derive a usable representative point for
  nodes, ways, and relations. Reject malformed or unrepresentable geometry
  instead of guessing coordinates.
- Cache each raw Overpass JSON response under ignored `data/` using a key that
  includes the query, region, and source version. Save query/region identity,
  endpoint, fetch time, response checksum, and completion status. Repeated
  enrichment/scoring and real-import runs use the same cached snapshot without
  contacting Overpass; explicitly refresh the OSM cache to fetch newer data.
  Keep this cache separate from the Q-ID-keyed Wikidata cache.
- Use a low concurrency limit, bounded timeouts, and retries with exponential
  backoff and jitter for transient network errors, 429, and 5xx responses;
  honor `Retry-After` where present. Only cache validated complete responses.
  Report failed regions, attempts, and cache freshness explicitly. If any
  required region has no usable cached response, allow an incomplete dry-run
  report but block the real DB upsert and suppress missing-upstream conclusions.
  Do not mistake partial coverage for deleted OSM objects.

### Wikidata and Wikipedia

- Prefer a valid `wikidata=Q…` tag on the OSM object.
- Resolve Q-IDs in batches and request only needed labels, descriptions,
  claims, coordinates, and sitelinks. Preserve source values and select
  canonical Staza values explicitly.
- Use an injectable network client and deterministic fixtures; unit tests never
  call Wikidata.
- Store refreshable, git-ignored JSON cache entries keyed by Q-ID, including
  fetch time and response metadata. Batch cache misses and support force refresh.
- Pace uncached Wikidata batches by `WIKIDATA_BATCH_DELAY_MS` (default 1000 ms)
  to avoid request bursts; cache-only runs do not wait.
- Resolve a Wikipedia reference only through an exact Wikidata sitelink match.
  Do not search or fuzzy-match names automatically in v1. Conflicting IDs,
  incompatible type, coordinate discrepancies, and ambiguous results remain
  unmatched/review-only.
- Wikidata presence is evidence of documentation, not proof of popularity.
  Wikipedia sitelinks are a stronger significance signal, not a guarantee.

### Additive catalog fields and provenance

Add nullable `primary_category` with allowed values `viewpoint`, `peak`,
`castle`, `waterfall`, and `mountain_pass`; add `tags TEXT[] NOT NULL DEFAULT
'{}'`. Retain the existing gameplay `type` for compatibility. New map
features expose `primary_category` and tags, falling back to the existing type
for old rows.

Retain `source_type = "osm"` and `source_external_id = "<osm-type>:<osm-id>"`,
such as `way:987654`. Store stable canonical IDs as `osm:<osm-type>:<osm-id>`.
Persist the Wikidata Q-ID, Wikipedia reference, and enrichment provenance in
additive metadata fields. Preserve OSM object type and ID distinctly; numeric
IDs alone are not globally unique across object types.

Initial semantic tags are `viewpoint`, `historic`, and `summit`, added only
when supported by source evidence. Do not use rarity as a tag or duplicate the
primary category as a tag.

### Category precedence and duplicate policy

When one real-world entity has multiple meanings, choose one primary category
in this order: **castle → peak → waterfall → viewpoint**. Preserve other
supported meanings as tags; do not create multiple collectibles for one
physical destination.

Same Wikidata Q-ID is a strong merge identity; same Wikipedia identity is also
strong evidence. Same normalized name plus very close distance and compatible
category can be reported for review, but is not sufficient alone. Proximity-only
matches are report-only and never destructive. Flag suspicious overlap with
existing collectibles, including quäldich passes, but never merge across source
systems automatically.

### Explainable quality scoring

Candidate score measures confidence in a collectible, not rarity, XP, or
popularity. Scores are deterministic, category-specific, capped at 100, and
include reasons. Shared weights:

| Signal | Points |
| --- | ---: |
| Explicit category tag | +10 |
| Meaningful name | +15 |
| Direct Wikidata Q-ID | +15 |
| Wikipedia sitelink | +20 |
| Explicit positive public-access evidence | +10 |
| Missing name | −20; normally caps score at 49 |

Category-specific signals:

| Category | Additional evidence |
| --- | --- |
| Viewpoint | Direction, `camera:direction`, or observation-specific metadata: +10 |
| Peak | Prominence ≥300 m: +20; prominence 100–299 m: +12; elevation alone: +5 (do not stack elevation and prominence); viewpoint trait: +5 |
| Castle | `castle_type`: +10; `tourism=attraction` or relevant structured heritage tag: +10 total |
| Waterfall | Height ≥10 m: +15; known height <10 m: +5; official website or strong structured identity: +10 |

Decision thresholds:

- **AUTO_PUBLISH:** score ≥75, no access conflict, and a usable OSM or
  unambiguous Wikidata label.
- **REVIEW:** score 50–74.
- **IGNORE:** score <50.
- **REJECT:** malformed/invalid records, invalid names, or confirmed private or
  inaccessible targets.

Missing OSM names are not fabricated. An exceptional unnamed record can only
be considered when a direct, unambiguous Wikidata identity supplies a usable
label plus strong category evidence. Uncertainty never lowers a threshold.

Worked examples:

| Category | Signals and arithmetic | Decision |
| --- | --- | --- |
| Viewpoint | Named, direct Q-ID, Wikipedia, access, observation metadata: 10+15+15+20+10+10 = 80 | AUTO_PUBLISH |
| Viewpoint | Named, direct Q-ID, access, observation metadata, no Wikipedia: 10+15+15+10+10 = 60 | REVIEW |
| Viewpoint | Unnamed generic viewpoint, public path and observation metadata: 10−20+10+10 = 10 | IGNORE |
| Peak | Named, direct Q-ID, Wikipedia, access, prominence ≥300 m, viewpoint trait: 10+15+15+20+10+20+5 = 95 | AUTO_PUBLISH |
| Peak | Named, prominence 100–299 m, access, viewpoint trait: 10+15+12+10+5 = 52 | REVIEW |
| Peak | Unnamed low-information peak with elevation alone: 10−20+5 = 0 | IGNORE |
| Castle | Named, direct Q-ID, Wikipedia, access, `castle_type`, structured heritage/tourism: 10+15+15+20+10+10+10 = 90 | AUTO_PUBLISH |
| Castle | Named, direct Q-ID, access, `castle_type`, no Wikipedia: 10+15+15+10+10 = 60 | REVIEW |
| Castle | Named minor feature with only category and one structured heritage signal: 10+15+10 = 35 | IGNORE |
| Waterfall | Named, direct Q-ID, Wikipedia, access, height ≥10 m, structured identity: 10+15+15+20+10+15+10 = 95 | AUTO_PUBLISH |
| Waterfall | Named, direct Q-ID, access, height ≥10 m, no Wikipedia: 10+15+15+10+15 = 65 | REVIEW |
| Waterfall | Unnamed small waterfall with known height <10 m: 10−20+5 = 0 | IGNORE |

These weights and thresholds are initial product rules. Validate on representative
German samples and raise thresholds if auto-published records are weak; do not
lower them just to increase map density.

### Access policy

Explicit `access=private/no` or `foot=private/no` on the target is a rejection;
nearby paths do not override a private tag. Positive access points require
explicit public/permissive foot access or a clearly public path signal, with
conflicting tags taking precedence. Unknown access is not assumed public;
missing evidence reduces confidence. Do not build a routing engine or infer
legal access.

### Rarity, gameplay value, and radius

- New OSM records use `common`; candidate score never determines rarity.
- Use independent category-based gameplay values: viewpoint **20**, peak **50**,
  castle **35**, waterfall **35**. These are deliberately modest relative to
  the existing quäldich elevation curve of 100–600 and the 100-XP first-level
  progression step. Candidate score never determines XP.
- All collectibles use a **100 m** collection radius, including OSM places,
  landmarks, and mountain passes.

### Licensing and attribution

OSM-derived data is subject to **ODbL 1.0**. Provide usage-proximate
attribution such as “© OpenStreetMap contributors” linking to
<https://www.openstreetmap.org/copyright>, and retain enough source identity and
provenance to identify the source data. Wikidata data is **CC0**; preserve the
Q-ID, Wikipedia reference, and enrichment provenance. Do not remove or conflate
quäldich catalog attribution and existing OpenFreeMap/OSM basemap attribution.

## Implementation plan

1. Add an additive migration, domain/repository mappings, and World feature
   normalization for primary category, tags, and source/enrichment provenance.
   Keep one canonical collectibles table and the existing World/MapLibre
   pipeline; add no separate rendering layer.
2. Implement the Overpass ingestion adapter for four exact tag classes,
   deterministic German region tiling, raw-response caching, retry/backoff,
   partial-failure reporting, geometry validation, and stable OSM identity.
   Preserve the existing source-independent normalized contract so a future
   Geofabrik adapter can replace only ingestion.
3. Implement a batch Wikidata client, Q-ID keyed local cache, exact sitelink
   reconciliation, and explicit unresolved/error states. No fuzzy name search.
4. Implement category-specific score/reasons, access gates, deterministic
   entity grouping, safe duplicate reporting, and import planning/upsert.
5. Add dry-run and real import commands, bounded report samples, optional
   ignored JSONL inspection artifact, operational documentation, and license
   attribution.
6. Validate on mountainous, rural, urban, and tourist German areas; manually
   inspect random AUTO_PUBLISH, REVIEW, and IGNORE candidates and tune only
   toward higher precision.
7. Manually open Staza World after import and verify POIs, existing quäldich
   passes, shared styling, selection, visited/unvisited, viewport performance,
   attribution, and browser console.

## Import behavior and report

Provide dry-run and real import commands following the existing
`npm run import:quaeldich` pattern. Dry-run parses, enriches, scores,
deduplicates, and reports without database writes.

The concise report includes OSM objects scanned; category candidates; direct,
resolved, and unmatched Wikidata counts; AUTO_PUBLISH, REVIEW, IGNORE, and
REJECT counts; created, updated, and unchanged rows; possible duplicates; and
previously imported rows missing upstream. Include category totals and small
samples of top scores, review candidates, rejection reasons, and ambiguous
matches. Optionally write JSONL under ignored `tmp/`, never as a runtime
catalog.

Imports are idempotent. Metadata changes update the same canonical Staza ID.
Missing upstream records are reported, never automatically deleted or archived.
Wikidata outages reuse cached data when available, mark unresolved enrichment,
report failures, and do not relax quality thresholds.

## Operations

After implementing the revised Overpass ingestion, apply database migrations
and run the manual importer:

```sh
npm run migrate
npm run import:osm-wikidata -- --dry-run
npm run import:osm-wikidata
```

The dry-run reads the existing catalog but does not write to PostgreSQL; it
does not run migrations. The planned importer first obtains complete
coverage from the Overpass cache or fetches uncached regions; a real import
upserts only `AUTO_PUBLISH` rows when coverage is complete. Provide an
explicit OSM refresh option separate from `--force-refresh` for Wikidata.
Keep `--input <jsonl>` and optional `--metadata <json>` for replaying an
already normalized source stream; keep `--write-jsonl [tmp/path.jsonl]` for
inspection. Raw Overpass responses and the Wikidata cache live separately
under ignored `data/`; inspection files live under ignored `tmp/`.

The source-independent importer contract is one JSON object per line:

```json
{"osmType":"way","osmId":"987654","latitude":50.1,"longitude":8.6,"tags":{"historic":"castle","name":"Example Castle"}}
```

`osmType` and `osmId` remain separate through import; the unique source identity
is `<osmType>:<osmId>` and the stable catalog ID is `osm:<osmType>:<osmId>`.
Only scoring-relevant source tags are emitted; unsupported geometry is counted
as rejected rather than assigned a guessed coordinate. Raw Overpass JSON is
cached separately before conversion to this contract.

## Test fixtures and coverage

Committed fixtures should include small raw Overpass JSON responses for nodes,
ways, relations, region overlap, malformed geometry, HTTP errors, and incomplete
coverage, alongside normalized OSM JSONL, Wikidata entities, and a Q-ID-keyed
cache entry for:

- high-quality named viewpoint with Wikidata and weak unnamed viewpoint;
- significant and low-information peaks;
- castle plus viewpoint sharing an entity identity;
- waterfall with a Wikipedia sitelink;
- ambiguous Wikidata name/sitelink match;
- private/inaccessible target;
- malformed geometry and duplicate OSM source identity.

Tests cover ingestion/category detection, identity/coordinates/metadata,
query tiling, cache replay/refresh, retry/backoff, partial-failure gating,
direct Q-ID enrichment, Wikipedia detection, cache behavior, no fuzzy false
positive, deterministic scores/reasons and all decision bands, identity-based
deduplication, proximity-only non-merge, idempotent import/update/no-delete,
and World bbox/category/tags/source/attribution/visited behavior. Verify
historical GameEvents remain unchanged, imports award no XP, and no old
activities are reprocessed. Tests must not require live OSM or Wikidata.
The v1 ingestion tests use mocked Overpass responses and no live OSM service.

## Operational cost and risks

Initial planning estimate: roughly 80-150 bounded requests for approximately
1-degree German tiles, with all four tag filters in each request; the exact
number depends on the final boundary/intersection scheme and tile sizes.
At one request in flight and approximately 5-30 seconds per request, initial
ingestion may take tens of minutes to several hours, longer under throttling.
Repeated runs on a complete cached snapshot issue zero Overpass requests and
spend time mainly on local processing and Wikidata cache misses. Cache size
depends on response geometry; measure it on representative regions before
choosing a disk budget. There is no mandatory PBF, Python dependency, or
10 GB temporary-disk requirement. Public Overpass capacity is shared and
availability is not guaranteed; avoid aggressive concurrency or repeated
full refreshes. Wikidata duration still depends on Q-ID count and batching.

False-positive risks include incorrect/stale OSM tags or IDs, geometry
representative errors, and access assumptions. False negatives include missing
names or Wikidata IDs, missing prominence/height data, and unknown access.
Resolve uncertainty conservatively and prefer false negatives.

## Acceptance criteria

- Dry-run makes no database changes; real import is repeatable and preserves
  stable IDs.
- Published rows meet strict, explainable, category-specific thresholds; review
  and ignore candidates are not published.
- Source identities, Wikidata/Wikipedia references, enrichment provenance, and
  attribution are available through the canonical World model.
- Imported collectibles use the existing bbox API and shared MapLibre layers;
  category and tags are exposed without breaking visited/unvisited behavior.
- Existing quäldich catalog, curated items, quests, basemap attribution, and
  historical activity/GameEvent snapshots remain intact.
- No XP is awarded and no old activity is reprocessed by import.
- Representative area inspection finds no obvious low-quality auto-publication
  or marker explosion; World remains performant and has no console errors.
- Tests and build pass without live OSM/Wikidata dependencies.

## Validation

1. Run mocked Overpass ingestion tests, focused unit and persistence tests,
   then the build and full test suite.
2. Run the Germany dry-run and inspect aggregate counts and candidate samples.
3. Validate multiple representative areas and manually sample all decision
   classes; raise thresholds if any AUTO_PUBLISH candidate is clearly weak.
4. Run the real import, then repeat it and confirm unchanged rows and stable IDs.
5. Verify missing-upstream reporting without deletion, no XP/history changes,
   and World rendering, selection, visited state, attribution, and performance.
