# tighten-road-cycling-flowline-publication

## Goal

Publish fewer, better Road Cycling Flowlines: roads actively worth recommending,
not merely legally rideable roads. Retain the existing OSM snapshot, normalization,
candidate generation, scoring and import architecture.

## Scope and constraints

- Reuse road-cycling eligibility, quality, confidence and independent
  Flow/Endurance/Explore/roadQuality scores.
- Preserve full geometry, candidate identities, joining/branch behavior,
  city-limit splitting, minimum 1 km, preferred 2-8 km, surface/smoothness
  checks, cycleway evidence, link limits and bicycle/access hard rejects.
- No storage optimization, simplification, schema migration, database writes or
  operational reimport. Historical gameplay and completions remain unchanged.
- New traffic exclusions are Flowline-publication rules, not foundational
  eligibility rules that would zero every independent style score.

## Decisions

- Any contributing motor-road carriageway, including a small link connector,
  with maxspeed >=70 km/h excludes the entire candidate from publication.
  Separate `highway=cycleway` ways are exempt from motor-road speed/class gates.
- Primary roads require known speed <=50 km/h, good sealed surface,
  good/excellent smoothness and explicit on-carriageway cycle-lane or usable
  paved shoulder evidence. Primary roads with missing speed do not publish.
- Other motor roads at 60-69 km/h require the same strong comfort evidence and
  receive a strong quality penalty. The 50-60 interval remains unfavorable.
- Secondary roads receive stronger class penalties and cannot publish without
  known speed. Tertiary is a normal candidate; missing speed reduces confidence
  more than on unclassified roads. Existing unclassified safeguards remain.
- Bicycle permission alone, generic shoulders, ambiguous/advisory lanes, and
  separately mapped parallel cycleways do not prove carriageway comfort.
  Never invent traffic counts, width, protection or directional suitability.
- Qualifying infrastructure is an explicit exclusive lane on both sides (or
  one side of an explicitly one-way carriageway), or shoulders on both sides
  with good sealed surface and explicit width >=1.5 m. Unknown width is not usable
  shoulder evidence.
- Target publication floors are quality >=82 and confidence >=75, calibrated
  using existing score ranges and real-input comparisons, without weakening
  hard gates to achieve a count target.
- Retain only the bounded traffic tags actually consumed by the policy.
  Parse explicit numeric km/h and mph conservatively; unsupported symbolic or
  conditional speed values remain unknown, never implicitly safe.
- Preserve joining/splitting: a mixed-speed chain fails publication rather than
  averaging a dangerous section away or introducing new segmentation.

## Current-state evidence

The existing scorer gives speed only 1-5 points, averages known speeds, rewards
primary roads and omits traffic uncertainty from confidence. Publication uses
80/70. The generic eligibility layer is shared by all independent style scorers.
Existing selectors retain maxspeed but drop lanes/cycleway/shoulder attributes.
Existing analysis supports GeoJSON, but generic eligibility and first-N sampling
are not named publication or representative sampling.

Older normalized extracts cannot recover previously dropped infrastructure
tags. Compare policies on identical inputs. If a source PBF is available,
regenerate using the existing extractor and compare both policies on that same
refreshed input; otherwise explicitly report that infrastructure exceptions
are conservatively unavailable in old data and cover them with focused fixtures.

## Implementation plan

1. Capture existing focused tests, source metadata, importer dry-run counts,
   named publication by highway/speed and independent score distributions.
2. Retain required lanes, cycle-lane and shoulder attributes; share conservative
   speed/evidence normalization without replacing independent style inputs.
3. Add a typed per-way publication comfort evaluator with explicit reasons.
   Check every contributing motor-road way and preserve foundational eligibility.
4. Strengthen existing Flow class/speed contributions and confidence uncertainty.
   Reuse interruption/priority penalties, avoid double counting or rural-speed
   comfort bonuses, integrate non-bypassable comfort gating, and version changed
   score formulas using existing metadata.
5. Extend existing dry-run/analysis with named publication, comfort reasons,
   highway/speed/evidence buckets and 80/70 versus 82/75 sensitivity.
   Annotate GeoJSON and export deterministic bounded stratified samples.
6. Run focused regression tests and build; compare before/after on identical
   full inputs, inspect samples locally and report counts and limitations.

Baseline precedes score changes; normalization precedes the gate; the gate
precedes score integration and analysis; final validation follows all changes.
Run large extraction analyses sequentially and preserve unrelated worktree edits.

## Acceptance criteria

- Identical input produces identical candidates/geometry/IDs and fewer named
  publications. Zero published motor-road candidates contain a >=70 km/h way.
- Primary and 60-69 km/h exceptions require the confirmed evidence on every
  applicable way. Permission, averages and high scalar scores cannot bypass gates.
- Good lower-risk tertiary/unclassified examples and paved road-bike cycleways
  remain represented when present in the input; not every paved road must publish.
- Missing/unrecognized speeds carry explicit class-dependent uncertainty.
- Flowline traffic rejection does not zero Endurance/Explore/roadQuality.
- All existing length, surface, access, cycleway, link and segmentation checks
  retain their intended behavior. No live catalog or history is changed.

## Validation

Run focused Vitest suites for Flowline quality/scoring/candidates/normalization,
generic eligibility/scoring/route aggregation/snapshots, and the new traffic
and analysis helpers; run `npm run build`. Add regression coverage for cutoff
boundaries, mph/unknown/unlimited speeds, mixed ways and connectors, narrow
exceptions and false-positive infrastructure, class uncertainty, 82/75 floors,
retained positive examples and independent score semantics.

Use `npm run import:fartleks -- --snapshot <snapshot> --dry-run` and
`npm run analyze:road-segments -- --snapshot <snapshot> --geojson <output>`,
with existing appropriate heap settings. Save counts, percentage reductions,
source identity, reasons and stratified local GeoJSON outside committed data.
Distinguish programmatic inspection from visual review and report actual coverage.

## Validation outcome

On the same cycleway-inclusive Germany extract (`geofabrik-germany-2026-10-03`),
all 897,657 candidate identities and coordinate arrays were unchanged. Named
publications decreased from 75,154 to 28,747 (61.7%); no new identities qualified.

| Highway | Before | After |
| --- | ---: | ---: |
| Primary | 7,342 | 0 |
| Secondary | 23,247 | 2,580 |
| Tertiary | 26,517 | 11,969 |
| Unclassified | 17,406 | 13,556 |
| Cycleway | 642 | 642 |

All 36,125 previously published candidates containing explicitly numeric
motor-road speed >=70 km/h were removed; no high-speed motor-road candidates
qualified after the change. With the new gates, threshold sensitivity was
30,004 named at 80/70, 28,747 at 82/75 and 19,597 at 85/80. The chosen 82/75
retains substantial good tertiary/unclassified coverage and all previously
qualifying named cycleways without weakening the comfort gates.

The 113 focused tests and TypeScript build passed. Generic eligibility and
Endurance/Explore/roadQuality distribution summaries were unchanged. All 367
stratified GeoJSON features were inspected programmatically for valid geometry,
tags and publication invariants, including retained examples from each expected
class. This was not a visual map review.

The existing snapshot lacks the newly retained lane/shoulder tags and no source
PBF was available locally. Consequently primary and 60-69 km/h infrastructure
exceptions were validated by focused fixtures, not a refreshed-country extract.
No database writes or operational import were performed.
