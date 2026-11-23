import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildFartlekCandidates } from "./fartlekCandidates.js";
import { scoreFartlekCandidate } from "./fartlekScore.js";
import { flowlineAnalysisProfile, sampleFlowlineAnalysis } from "./flowlineAnalysis.js";
import { evaluateRoadCyclingEligibility } from "./roadSegment/eligibility.js";
import type { FartlekCandidate, ScoredFartlekCandidate } from "./fartlekModel.js";
import { readFartlekOSMSnapshot } from "./fartlekSnapshot.js";

/**
 * Dev-only analysis for the generic road-cycling segment model.
 *
 * Reads a Fartlek OSM snapshot (or a candidates JSON array), scores every candidate with the full
 * segment model (flow/endurance/explore/roadQuality + dataConfidence), prints distribution stats so
 * weights can be calibrated against real data, and optionally writes a GeoJSON debug file whose
 * features carry every score for inspection in any GIS/map viewer. It never touches the database.
 *
 * Usage:
 *   npm run analyze:road-segments -- --snapshot <file> [--geojson <out.geojson>] [--sample-per-group <n>]
 *   npm run analyze:road-segments -- --candidates <file.json> [--geojson <out.geojson>]
 */

interface Arguments {
  snapshotFile?: string;
  candidatesFile?: string;
  geojsonFile?: string;
  limit?: number;
  samplePerGroup?: number;
  baselineFile?: string;
}

const argumentsFrom = (values: string[]): Arguments => {
  const result: Arguments = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--snapshot" || value === "--candidates" || value === "--geojson" || value === "--limit" ||
      value === "--sample-per-group" || value === "--baseline-identities") {
      const argument = values[++index];
      if (!argument || argument.startsWith("--")) throw new Error(`${value} requires a value.`);
      if (value === "--snapshot") result.snapshotFile = path.resolve(argument);
      else if (value === "--candidates") result.candidatesFile = path.resolve(argument);
      else if (value === "--geojson") result.geojsonFile = path.resolve(argument);
      else if (value === "--baseline-identities") result.baselineFile = path.resolve(argument);
      else {
        const count = Number(argument);
        if (!Number.isSafeInteger(count) || count <= 0) throw new Error(`${value} must be a positive integer.`);
        if (value === "--limit") result.limit = count;
        else result.samplePerGroup = count;
      }
    } else throw new Error(`Unknown argument: ${value}`);
  }
  if (result.limit && result.baselineFile) throw new Error("Baseline comparison requires the full candidate population.");
  if (result.samplePerGroup && !result.geojsonFile) throw new Error("--sample-per-group requires --geojson.");
  return result;
};

const loadCandidates = async (args: Arguments): Promise<FartlekCandidate[]> => {
  if (args.candidatesFile) {
    return JSON.parse(await readFile(args.candidatesFile, "utf8")) as FartlekCandidate[];
  }
  if (args.snapshotFile) {
    const snapshot = await readFartlekOSMSnapshot(args.snapshotFile);
    const ways = snapshot.records.filter((record) => record.osmType === "way");
    const boundaryNodes = snapshot.records.filter((record) =>
      record.osmType === "node" && record.tags.traffic_sign === "city_limit");
    const controlNodes = snapshot.records.filter((record) =>
      record.osmType === "node" && record.tags.traffic_sign !== "city_limit");
    return buildFartlekCandidates(ways, { boundaryNodes, controlNodes });
  }
  throw new Error("Provide --snapshot <file> or --candidates <file>.");
};

interface ScoredRow {
  candidate: FartlekCandidate;
  scored: ScoredFartlekCandidate;
  flow: number;
  endurance: number;
  explore: number;
  roadQuality: number;
  dataConfidence: number;
  eligible: boolean;
}

const distribution = (label: string, values: number[]): string => {
  if (values.length === 0) return `${label}: (no data)`;
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return `${label}: n=${values.length} min=${sorted[0]} p25=${quantile(0.25)} p50=${quantile(0.5)} ` +
    `p75=${quantile(0.75)} p90=${quantile(0.9)} max=${sorted[sorted.length - 1]} mean=${mean.toFixed(1)}`;
};

const toGeoJSON = (rows: ScoredRow[]): string => JSON.stringify({
  type: "FeatureCollection",
  features: rows.map((row) => ({
    type: "Feature",
    geometry: { type: "LineString", coordinates: row.candidate.coordinates },
    properties: {
      id: row.candidate.id,
      name: row.candidate.name ?? null,
      lengthMeters: Math.round(row.candidate.lengthMeters),
      eligible: row.eligible,
      flowScore: row.flow,
      enduranceScore: row.endurance,
      exploreScore: row.explore,
      roadQualityScore: row.roadQuality,
      dataConfidence: Number(row.dataConfidence.toFixed(3)),
      ...flowlineAnalysisProfile(row.scored),
      decision: row.scored.decision,
      rejectionReason: row.scored.rejectionReason ?? null,
      reasons: row.scored.reasons,
      sourceWayIds: row.candidate.sourceWayIds,
      tagsBySegment: row.candidate.tagsBySegment
    }
  }))
});

const main = async (): Promise<void> => {
  const args = argumentsFrom(process.argv.slice(2));
  const candidates = await loadCandidates(args);
  const limited = args.limit ? candidates.slice(0, args.limit) : candidates;
  const rows: ScoredRow[] = limited.map((candidate) => {
    const scored = scoreFartlekCandidate(candidate);
    const scores = scored.scores;
    if (!scores) throw new Error(`Missing segment scores for ${candidate.id}.`);
    return {
      candidate,
      scored,
      flow: scores.flow,
      endurance: scores.endurance,
      explore: scores.explore,
      roadQuality: scores.roadQuality,
      dataConfidence: scores.dataConfidence,
      eligible: evaluateRoadCyclingEligibility(candidate).eligible
    };
  });

  const eligible = rows.filter((row) => row.eligible);
  console.log(`Analyzed ${rows.length} candidate(s); ${eligible.length} eligible.`);
  console.log(distribution("flow     ", eligible.map((row) => row.flow)));
  console.log(distribution("endurance", eligible.map((row) => row.endurance)));
  console.log(distribution("explore  ", eligible.map((row) => row.explore)));
  console.log(distribution("quality  ", eligible.map((row) => row.roadQuality)));
  console.log(distribution("confid.%", eligible.map((row) => Math.round(row.dataConfidence * 100))));

  const counts = new Map<string, number>();
  const increment = (key: string): void => { counts.set(key, (counts.get(key) ?? 0) + 1); };
  const publishedIds = new Set<string>();
  for (const row of rows) {
    const profile = flowlineAnalysisProfile(row.scored);
    increment(`speed.${profile.speedBucket}`);
    for (const highway of profile.highwayClasses) increment(`highwaySpeed.${highway}.${profile.speedBucket}`);
    increment(`decision.${row.scored.decision}`);
    if (row.scored.rejectionReason) increment(`reason.${row.scored.rejectionReason}`);
    if (profile.published) {
      publishedIds.add(row.candidate.id);
      increment("publish.named");
      increment(`publish.speed.${profile.speedBucket}`);
      for (const highway of profile.highwayClasses) {
        increment(`publish.highway.${highway}`);
        increment(`publish.highwaySpeed.${highway}.${profile.speedBucket}`);
      }
    }
    for (const [quality, confidence] of [[80, 70], [82, 75], [85, 80]]) {
      if (!row.scored.rejectionReason && row.candidate.name &&
        row.scored.suitabilityScore >= quality && row.scored.mappingConfidence >= confidence) {
        increment(`threshold.${quality}.${confidence}.named`);
      }
    }
  }
  for (const [key, count] of [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    console.log(`${key}: ${count}`);
  }

  if (args.baselineFile) {
    const baseline: { candidateCount: number; geometryDigest: string; publishedIds: string[] } =
      JSON.parse(await readFile(args.baselineFile, "utf8"));
    if (!Array.isArray(baseline.publishedIds) || typeof baseline.geometryDigest !== "string") {
      throw new Error("Baseline must contain publishedIds and geometryDigest.");
    }
    const digest = createHash("sha256");
    for (const candidate of candidates) digest.update(JSON.stringify([candidate.id, candidate.coordinates]));
    if (baseline.candidateCount !== candidates.length || baseline.geometryDigest !== digest.digest("hex")) {
      throw new Error("Baseline comparison input mismatch: candidate identities/geometry changed.");
    }
    const previous = new Set(baseline.publishedIds);
    const added = [...publishedIds].filter((id) => !previous.has(id)).length;
    const removed = [...previous].filter((id) => !publishedIds.has(id)).length;
    console.log(`Identical candidates/geometry verified. Named publication: ${previous.size} -> ${publishedIds.size}; ` +
      `removed=${removed}, added=${added}, reduction=${previous.size ? (100 * (previous.size - publishedIds.size) / previous.size).toFixed(1) : "0"}%.`);
  }

  if (args.geojsonFile) {
    const sample = args.samplePerGroup ? sampleFlowlineAnalysis(rows, args.samplePerGroup) : rows;
    await writeFile(args.geojsonFile, toGeoJSON(sample), "utf8");
    console.log(`Wrote ${sample.length} feature(s) from ${rows.length} analyzed candidates to ${args.geojsonFile}`);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
