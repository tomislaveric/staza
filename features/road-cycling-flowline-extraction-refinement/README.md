# road-cycling-flowline-extraction-refinement

## Goal

Refine the Germany OSM Flowline pipeline so published segments are roads a serious road cyclist would generally enjoy riding. Highway class is only a candidate filter; road surface, smoothness, legal access, continuity, length, traffic context, and data confidence determine publication. Preserve full geometry and all gameplay and historical semantics.

## Scope

- Keep the existing extraction, normalization, candidate generation, and import architecture; make focused changes rather than replacing the pipeline.
- Include road classes primary, primary_link, secondary, secondary_link, tertiary, tertiary_link, unclassified, and cycleway as candidates. Continue excluding residential, service, track, path, footway, and living_street for V1.
- Analyze a refreshed Germany extract including cycleways before finalizing data-based priors, score/confidence thresholds, and projected import impact.
- Classify surface and smoothness explicitly; reject hard access/surface/smoothness violations before scoring.
- Split or stop candidate chains at meaningful quality/access transitions so unsuitable ways cannot be hidden inside a valid average.
- Preserve complete LineString coordinates; do not change activity traversal, completion, XP, GameEvents, or historical completion truth.

## Decisions

- Regenerate/obtain a Germany extract including `highway=cycleway`; the checked-in 2026-10-03 snapshot excludes cycleways and cannot support their distribution analysis.
- `access=destination` is rejected unless bicycle-specific tags explicitly show general bicycle permission.
- `bicycle=use_sidepath` rejects a road-carriageway candidate; it must not reject the separate cycleway itself ([OSM tagging](https://wiki.openstreetmap.org/Tag:bicycle=use_sidepath)).
- Link roads are compatible connectors only, never standalone published Flowlines; connector geometry is capped at 300 m and 20% of the candidate. The cap is based on Germany link-way length data (per-class p99 is 169–299 m).
- `paving_stones` and concrete-plate surfaces are rejected for V1.
- Reject `access=no|private`, `bicycle=no`, clearly unsuitable surfaces, and clearly poor/impassable smoothness before quality scoring.
- Missing surface may qualify for higher road classes at class-specific confidence; unclassified requires stronger positive evidence and is rejected when both surface and smoothness are missing.
- `access=destination` follows the conservative through-traffic policy above; see [German OSM access guidance](https://wiki.openstreetmap.org/wiki/DE:Key:access).
- Maxspeed is a soft enjoyment/traffic signal, never a sole hard rejection. `priority_road` means signposted right-of-way, not generic road quality, and receives no unconditional positive bonus ([OSM priority_road](https://wiki.openstreetmap.org/wiki/Key:priority_road)).
- Keep the 1 km minimum and 2–8 km preferred length band; use measured publication floors of quality >=80 and confidence >=70 on the existing 0–100 scales.
- Reimport complete snapshots by upserting current Flowlines and archiving absent ones. Never physically delete rows or cascade completion/history data; materially changed segments may receive new IDs while old IDs remain archived for historical lookup.

## Current-state evidence

- The committed snapshot is snapshot v2, source version `geofabrik-germany-2026-10-03`, with 1,710,128 selected ways and no cycleways.
- Refreshed candidate-way counts: primary 243,958; secondary 516,543; tertiary 488,472; unclassified 421,807; primary_link 17,472; secondary_link 14,010; tertiary_link 7,866; cycleway 86,143.
- Missing-surface rates in that snapshot: primary 1.9%, secondary 5.8%, tertiary 9.8%, unclassified 26.4%; missing smoothness is 63.3%, 71.2%, 75.1%, and 84.0%, respectively.
- Road surfaces: asphalt 1,467,905; surface missing 195,931; paved 12,917; paving_stones 7,849; sett 6,747; concrete 5,190; compacted 2,668; gravel 2,358; cobblestone 2,144; concrete:plates 1,276. Smoothness: missing 1,273,386; good 231,382; excellent 175,093; intermediate 24,275; bad 5,035; very_bad 744; horrible 79; very_horrible 18; impassable 6.
- Road bicycle tags: missing 1,509,363; use_sidepath 132,046; yes 34,178; no 24,678; designated 3,325; optional_sidepath 5,954. Road access tags: missing 1,695,994; yes 5,018; private 4,007; no 1,748; destination 1,528.
- Road maxspeed: missing 512,922; 50 683,647; 100 185,249; 70 136,390; 30 127,353; 60 30,469; 80 17,659; 40 9,361. Numeric speeds remain soft signals.
- A cycleway-inclusive extract from the same local PBF contains 86,143 `highway=cycleway` ways: asphalt 45,405, paving_stones 17,418, missing surface 14,742, paved 2,116, and concrete 1,142. Smoothness is missing on 61,314; bicycle is missing on 56,546, with designated 24,527 and yes 4,824; access is missing on 84,703, with no 565 and private 349; maxspeed is missing on 85,634. These distributions informed the stricter cycleway evidence gate.
- Full candidate generation on 1,796,271 ways produced 897,657 candidates. The final 80/70 dry-run produced 85,479 auto-publish candidates and 75,154 named Flowlines: primary 7,342, secondary 23,247, tertiary 26,517, unclassified 17,406, cycleway 642. 10,325 otherwise accepted candidates were skipped for missing names. Most rejected candidates were below 1 km (787,898); 21 candidates were rejected because link geometry dominated.
- Threshold sensitivity on this extract: 70/60 -> 78,383 named Flowlines; 80/70 -> 75,154; 80/80 -> 70,454. The 80/70 choice removes lower-scoring candidates while retaining tested cases such as tertiary+paved; the hard gates and unclassified evidence rule operate independently of the score.
- The projected count is about 79% higher than the previous 42,001 named baseline. This reflects the old scoring rule's metadata-completeness penalty and the changed segmentation/input set, not an intended guarantee that quantity decreases; invalid access, rough surfaces, poor smoothness, and weak unclassified data are now rejected explicitly.
- Current importer/scorer produces 42,001 named publishable Flowlines from that snapshot. This is a baseline, not the projected result of the new rules.
- Current candidate generation joins ways by ref/name and shared endpoints and splits at city-limit nodes, but does not split on surface/access suitability changes.
- Completion rows reference Flowline rows with `ON DELETE CASCADE`; deletion would destroy history and is prohibited.

## Implementation plan

1. Refresh the full Germany extract with cycleways and report distributions by class for surface, smoothness, bicycle, access, maxspeed, missing tags, and priority-road values. Compare current and proposed decision counts by class and reason. (Completed for the local PBF dated 2026-10-03.)
2. Add `src/osm/roadCyclingFlowlineQuality.ts` with reusable surface/smoothness classifiers, access policy, hard-rejection reasons, quality scoring, separate data-confidence calculation, and publication predicate.
3. Use conservative unknown/compound-tag handling. GOOD surfaces include clear sealed surfaces after refreshed distribution review; reject gravel, dirt, unpaved, compacted, loose/rough surfaces, paving stones, concrete plates, and ambiguous compounds containing an unsuitable constituent.
4. Apply suitability-aware segmentation in `src/osm/fartlekCandidates.ts`. Keep city-limit and branch-point behavior, preserve all source coordinates, split on incompatible access/surface/smoothness/class transitions, and publish only contiguous suitable portions meeting length requirements.
5. Ensure links can connect compatible parent roads only as a minor connector (<=300 m and <=20% of the candidate), and cannot independently qualify. Ensure cycleways use a stricter evidence/length/continuity check and interpret bicycle tags in the way context.
6. Delegate scoring and publication in `src/osm/fartlekScore.ts` to the new model, with hard rejection before score, stable inspectable reasons, and separate quality/confidence fields. Keep production payloads compact.
7. Extend complete snapshot import to upsert present Flowlines and archive previously published OSM Flowlines missing from a verified complete snapshot. Incomplete snapshots cannot retire catalog rows; preserve completion rows and historical activity/GameEvent snapshots.
8. Run a full dry-run against the refreshed dataset, report the final thresholds and expected count change, and only then perform operational reimport with a database backup and safe archival behavior. (Dry-run projection: 75,154 named at 80/70; no production import is performed by this implementation.)

## Acceptance criteria

- Accept: secondary + asphalt; tertiary + paved; unclassified + asphalt + bicycle=yes; primary with missing surface only when its measured confidence policy allows it; suitable dedicated cycleway with evidence of sealed surface, bicycle access, continuity, and sufficient length.
- Reject: unclassified + gravel; tertiary + dirt; secondary + bicycle=no; primary + access=private; unclassified with surface and smoothness both missing; asphalt + very_bad smoothness; road + bicycle=use_sidepath; restrictive general access.
- `access=destination` follows the explicit bicycle-permission rule. High maxspeed affects score only.
- Links never publish standalone or dominate a candidate; compatible connector share is limited to 300 m and 20%. Mixed suitable/unsuitable surfaces do not become one Flowline; any retained suitable portion must independently meet length and confidence thresholds.
- Unknown surfaces are never silently good; unknown smoothness does not alone reject a sufficiently evidenced paved road.
- Both quality >=80 and confidence >=70; neither score can override a hard invalid condition.
- Full source geometry is retained. Activity traversal/completion, XP, GameEvents, and historical snapshots are unchanged.
- Full reimport archives vanished identities without deleting completion/history; reimport is idempotent, and incomplete snapshots cannot archive rows.

## Files and validation

- Selectors/extraction: `src/osm/fartlekSelectors.ts`, `scripts/extract-osm-germany-fartleks.sh`, `src/osm/fartlekNormalize.ts`.
- Quality/scoring/segmentation: add `src/osm/roadCyclingFlowlineQuality.ts`; update `src/osm/fartlekScore.ts`, `src/osm/fartlekModel.ts`, and `src/osm/fartlekCandidates.ts`.
- Import safety: update `src/persistence/importFartleks.ts` and `src/persistence/fartlekRepository.ts`; modify `src/persistence/migrations.ts` only if unavoidable.
- Tests: add quality classifier/scoring cases and extend candidate segmentation, normalization, and import persistence tests for accepted/rejected/boundary cases, full geometry, mixed surfaces, archival, idempotence, and historical safety.
- Run focused Vitest suites, `npm run build`, and full refreshed-snapshot dry-run analysis before any production import.
