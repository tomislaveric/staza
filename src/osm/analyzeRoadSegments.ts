import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildFartlekCandidates } from "./fartlekCandidates.js";
import { scoreRoadCyclingSegment } from "./roadSegment/scoring.js";
import { calculateRoadCyclingFlowlineQuality } from "./roadCyclingFlowlineQuality.js";
import { evaluateRoadCyclingEligibility } from "./roadSegment/eligibility.js";
import type { FartlekCandidate } from "./fartlekModel.js";
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
 *   npm run analyze:road-segments -- --snapshot <file> [--geojson <out.geojson>] [--limit <n>]
 *   npm run analyze:road-segments -- --candidates <file.json> [--geojson <out.geojson>]
 */

interface Arguments {
  snapshotFile?: string;
  candidatesFile?: string;
  geojsonFile?: string;
  limit?: number;
}

const argumentsFrom = (values: string[]): Arguments => {
  const result: Arguments = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--snapshot" || value === "--candidates" || value === "--geojson" || value === "--limit") {
      const argument = values[++index];
      if (!argument || argument.startsWith("--")) throw new Error(`${value} requires a value.`);
      if (value === "--snapshot") result.snapshotFile = path.resolve(argument);
      else if (value === "--candidates") result.candidatesFile = path.resolve(argument);
      else if (value === "--geojson") result.geojsonFile = path.resolve(argument);
      else result.limit = Number.parseInt(argument, 10);
    }
  }
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
      dataConfidence: Number(row.dataConfidence.toFixed(3))
    }
  }))
});

const main = async (): Promise<void> => {
  const args = argumentsFrom(process.argv.slice(2));
  const candidates = await loadCandidates(args);
  const limited = args.limit ? candidates.slice(0, args.limit) : candidates;
  const rows: ScoredRow[] = limited.map((candidate) => {
    const flow = calculateRoadCyclingFlowlineQuality(candidate);
    const scores = scoreRoadCyclingSegment(candidate, flow);
    return {
      candidate,
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

  if (args.geojsonFile) {
    await writeFile(args.geojsonFile, toGeoJSON(rows), "utf8");
    console.log(`Wrote ${rows.length} feature(s) to ${args.geojsonFile}`);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
