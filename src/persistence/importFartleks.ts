import { readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import path from "node:path";
import { config } from "../config.js";
import { scoreFartlekCandidate } from "../osm/fartlekScore.js";
import {
  ROAD_CYCLING_MIN_DATA_CONFIDENCE,
  ROAD_CYCLING_MIN_QUALITY_SCORE
} from "../osm/roadCyclingFlowlineQuality.js";
import { fartlekFromScoredCandidate } from "../osm/fartlekModel.js";
import type { FartlekCandidate } from "../osm/fartlekModel.js";
import type { Fartlek } from "../domain.js";
import { hasCompleteFartlekOSMSelectorCoverage, readFartlekOSMSnapshot } from "../osm/fartlekSnapshot.js";
import { buildFartlekCandidates } from "../osm/fartlekCandidates.js";
import { createDatabasePool } from "./database.js";
import { migrate } from "./migrate.js";
import { FartlekRepository } from "./fartlekRepository.js";

/**
 * Seeds the `fartleks` table.
 *
 * Three input modes are supported, from most to least automated:
 *
 *   --snapshot <file>     A committed Fartlek OSM way-geometry snapshot built by
 *                        `scripts/extract-osm-germany-fartleks.sh` (osmium PBF extraction ->
 *                        `buildFartlekSnapshot.ts`). Runs the full pipeline: reads the snapshot,
 *                        generates candidates (`buildFartlekCandidates`), scores each
 *                        (`scoreFartlekCandidate`), and publishes AUTO_PUBLISH candidates.
 *                        REVIEW/IGNORE/REJECT candidates are reported, and can optionally be
 *                        written to a JSONL file via `--write-review <file>` for manual review.
 *
 *   --candidates <file>  A JSON array of hand-authored/externally-generated `FartlekCandidate`
 *                        objects. Each is run through the same scoring pipeline as --snapshot.
 *
 *   --fartleks <file>    A JSON array of already-built `Fartlek` domain objects (e.g. manually
 *                        curated test segments), upserted as-is without scoring.
 */

interface Arguments {
  dryRun: boolean;
  snapshotFile?: string;
  candidatesFile?: string;
  fartleksFile?: string;
  writeReviewFile?: string;
}

const argumentsFrom = (values: string[]): Arguments => {
  const result: Arguments = { dryRun: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--dry-run") result.dryRun = true;
    else if (value === "--snapshot" || value === "--candidates" || value === "--fartleks" ||
      value === "--write-review") {
      const argument = values[++index];
      if (!argument || argument.startsWith("--")) throw new Error(`${value} requires a file path.`);
      if (value === "--snapshot") result.snapshotFile = path.resolve(argument);
      else if (value === "--candidates") result.candidatesFile = path.resolve(argument);
      else if (value === "--fartleks") result.fartleksFile = path.resolve(argument);
      else result.writeReviewFile = path.resolve(argument);
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  const modes = [result.snapshotFile, result.candidatesFile, result.fartleksFile].filter(Boolean);
  if (modes.length === 0) {
    throw new Error("Provide --snapshot <file>, --candidates <file>, or --fartleks <file>.");
  }
  if (modes.length > 1) {
    throw new Error("--snapshot, --candidates, and --fartleks cannot be combined.");
  }
  if (result.writeReviewFile && !result.snapshotFile && !result.candidatesFile) {
    throw new Error("--write-review requires --snapshot or --candidates.");
  }
  return result;
};

const readJsonArray = async <T>(file: string, label: string): Promise<T[]> => {
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${file} must contain a JSON array of ${label}.`);
  return parsed as T[];
};

interface CandidateImportResult {
  toPublish: Fartlek[];
  summary: Map<string, number>;
}

const fromCandidates = async (
  candidates: FartlekCandidate[],
  writeReviewFile?: string
): Promise<CandidateImportResult> => {
  const summary = new Map<string, number>();
  const toPublish: Fartlek[] = [];
  const reviewStream = writeReviewFile
    ? createWriteStream(writeReviewFile, { encoding: "utf8" })
    : undefined;
  const reviewFinished = reviewStream
    ? new Promise<void>((resolve, reject) => {
      reviewStream.once("finish", resolve);
      reviewStream.once("error", reject);
    })
    : undefined;
  let reviewFailure: Error | undefined;
  reviewFinished?.catch((error: unknown) => {
    reviewFailure = error instanceof Error ? error : new Error(String(error));
  });
  const increment = (key: string): void => {
    summary.set(key, (summary.get(key) ?? 0) + 1);
  };

  for (const candidate of candidates) {
    const scored = scoreFartlekCandidate(candidate);
    increment(`decision.${scored.decision}`);
    increment(`quality.${Math.floor(scored.suitabilityScore / 10) * 10}`);
    increment(`confidence.${Math.floor(scored.mappingConfidence / 10) * 10}`);
    for (const qualityThreshold of [70, 75, 80, 85]) {
      for (const confidenceThreshold of [60, 70, 80]) {
        if (!scored.rejectionReason &&
          scored.suitabilityScore >= qualityThreshold &&
          scored.mappingConfidence >= confidenceThreshold) {
          increment(`threshold.${qualityThreshold}.${confidenceThreshold}.candidate`);
          if (candidate.name) increment(`threshold.${qualityThreshold}.${confidenceThreshold}.named`);
        }
      }
    }
    const highwayClasses = new Set(candidate.tagsBySegment.map((tags) =>
      (tags.highway ?? "unknown").replace(/_link$/, "")
    ));
    for (const highway of highwayClasses) {
      increment(`highway.${highway}`);
      increment(`highwayDecision.${highway}.${scored.decision}`);
    }
    if (scored.decision === "AUTO_PUBLISH" && candidate.name) {
      toPublish.push(fartlekFromScoredCandidate(scored));
      increment("publish.named");
      for (const highway of highwayClasses) increment(`publish.highway.${highway}`);
    } else {
      if (scored.decision === "AUTO_PUBLISH") increment("skip.missing_name");
      else {
        increment(`reason.${scored.rejectionReason ?? (
          scored.suitabilityScore < ROAD_CYCLING_MIN_QUALITY_SCORE
            ? "REJECT_LOW_QUALITY_SCORE"
            : scored.mappingConfidence < ROAD_CYCLING_MIN_DATA_CONFIDENCE
              ? "REJECT_LOW_DATA_CONFIDENCE"
              : "REVIEW_REQUIRED"
        )}`);
      }
      if (reviewStream) {
        if (reviewFailure) throw reviewFailure;
        if (!reviewStream.write(`${JSON.stringify(scored)}\n`)) await once(reviewStream, "drain");
        if (reviewFailure) throw reviewFailure;
      }
    }
  }

  if (reviewStream) {
    reviewStream.end();
    await reviewFinished;
  }
  return { toPublish, summary };
};

const run = async (): Promise<void> => {
  const args = argumentsFrom(process.argv.slice(2));
  let toPublish: Fartlek[];
  let archiveAbsentOsmFlowlines = false;
  if (args.snapshotFile) {
    const snapshot = await readFartlekOSMSnapshot(args.snapshotFile);
    const ways = snapshot.records.filter((record) => record.osmType === "way");
    const boundaryNodes = snapshot.records.filter((record) =>
      record.osmType === "node" && record.tags.traffic_sign === "city_limit");
    const controlNodes = snapshot.records.filter((record) =>
      record.osmType === "node" && record.tags.traffic_sign !== "city_limit");
    const candidates = buildFartlekCandidates(ways, { boundaryNodes, controlNodes });
    console.log(`${candidates.length} candidate(s) generated from ${ways.length} way(s), ` +
      `${boundaryNodes.length} boundary node(s), ${controlNodes.length} control node(s).`);
    const result = await fromCandidates(candidates, args.writeReviewFile);
    for (const [key, count] of result.summary) console.log(`${key}: ${count}`);
    if (args.writeReviewFile) console.log(`Wrote candidate review details: ${args.writeReviewFile}`);
    toPublish = result.toPublish;
    archiveAbsentOsmFlowlines = hasCompleteFartlekOSMSelectorCoverage(snapshot.metadata);
  } else if (args.candidatesFile) {
    const candidates = await readJsonArray<FartlekCandidate>(args.candidatesFile, "FartlekCandidate objects");
    const result = await fromCandidates(candidates, args.writeReviewFile);
    for (const [key, count] of result.summary) console.log(`${key}: ${count}`);
    if (args.writeReviewFile) console.log(`Wrote candidate review details: ${args.writeReviewFile}`);
    toPublish = result.toPublish;
  } else {
    toPublish = await readJsonArray<Fartlek>(args.fartleksFile!, "Fartlek objects");
  }

  console.log(`${toPublish.length} Fartlek(s) ready to publish.`);
  if (archiveAbsentOsmFlowlines) {
    console.log("Complete snapshot import: previously published OSM Flowlines absent from this snapshot will be archived.");
  } else if (args.snapshotFile) {
    console.log("Snapshot coverage is incomplete; absent OSM Flowlines will not be archived.");
  }
  if (args.dryRun) {
    console.log("Dry run: no database changes made.");
    return;
  }
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required.");
  const pool = createDatabasePool(config.databaseUrl);
  try {
    await migrate(pool);
    const count = await new FartlekRepository(pool).upsertMany(toPublish, { archiveAbsentOsmFlowlines });
    console.log(`Upserted ${count} Fartlek(s).`);
  } finally {
    await pool.end();
  }
};

await run();
