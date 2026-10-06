import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { scoreFartlekCandidate } from "../osm/fartlekScore.js";
import { fartlekFromScoredCandidate } from "../osm/fartlekModel.js";
import type { FartlekCandidate } from "../osm/fartlekModel.js";
import type { Fartlek } from "../domain.js";
import { readFartlekOSMSnapshot } from "../osm/fartlekSnapshot.js";
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
  report: string[];
  reviewLines: string[];
}

const fromCandidates = (candidates: FartlekCandidate[]): CandidateImportResult => {
  const report: string[] = [];
  const reviewLines: string[] = [];
  const toPublish: Fartlek[] = [];
  for (const candidate of candidates) {
    const scored = scoreFartlekCandidate(candidate);
    if (scored.decision !== "AUTO_PUBLISH") {
      report.push(
        `SKIP ${candidate.id} (${scored.decision}, score=${scored.suitabilityScore}, ` +
          `mappingConfidence=${scored.mappingConfidence}): ${scored.rejectionReason ?? scored.reasons.join("; ")}`
      );
      reviewLines.push(JSON.stringify({ ...scored }));
      continue;
    }
    if (!candidate.name) {
      report.push(`SKIP ${candidate.id} (AUTO_PUBLISH but missing a name; assign one before publishing)`);
      reviewLines.push(JSON.stringify({ ...scored }));
      continue;
    }
    toPublish.push(fartlekFromScoredCandidate(scored));
    report.push(`PUBLISH ${candidate.id} -> ${candidate.name} (score=${scored.suitabilityScore})`);
  }
  return { toPublish, report, reviewLines };
};

const run = async (): Promise<void> => {
  const args = argumentsFrom(process.argv.slice(2));
  let toPublish: Fartlek[];
  let reviewLines: string[] = [];
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
    const result = fromCandidates(candidates);
    for (const line of result.report) console.log(line);
    toPublish = result.toPublish;
    reviewLines = result.reviewLines;
  } else if (args.candidatesFile) {
    const candidates = await readJsonArray<FartlekCandidate>(args.candidatesFile, "FartlekCandidate objects");
    const result = fromCandidates(candidates);
    for (const line of result.report) console.log(line);
    toPublish = result.toPublish;
    reviewLines = result.reviewLines;
  } else {
    toPublish = await readJsonArray<Fartlek>(args.fartleksFile!, "Fartlek objects");
  }

  if (args.writeReviewFile && reviewLines.length > 0) {
    await writeFile(args.writeReviewFile, `${reviewLines.join("\n")}\n`, "utf8");
    console.log(`Wrote ${reviewLines.length} non-published candidate(s) for review: ${args.writeReviewFile}`);
  }

  console.log(`${toPublish.length} Fartlek(s) ready to publish.`);
  if (args.dryRun) {
    console.log("Dry run: no database changes made.");
    return;
  }
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required.");
  const pool = createDatabasePool(config.databaseUrl);
  try {
    await migrate(pool);
    const count = await new FartlekRepository(pool).upsertMany(toPublish);
    console.log(`Upserted ${count} Fartlek(s).`);
  } finally {
    await pool.end();
  }
};

await run();
