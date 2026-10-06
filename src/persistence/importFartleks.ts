import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { scoreFartlekCandidate } from "../osm/fartlekScore.js";
import { fartlekFromScoredCandidate } from "../osm/fartlekModel.js";
import type { FartlekCandidate } from "../osm/fartlekModel.js";
import type { Fartlek } from "../domain.js";
import { createDatabasePool } from "./database.js";
import { migrate } from "./migrate.js";
import { FartlekRepository } from "./fartlekRepository.js";

/**
 * Seeds the `fartleks` table from a JSON file.
 *
 * No live OSM/osmium extraction pipeline exists yet (see
 * features/milestone-18-fartlek-segment-challenges/README.md), so this script accepts
 * hand-authored or externally-generated input in one of two shapes:
 *
 *   --candidates <file>  A JSON array of `FartlekCandidate` objects. Each is run through the
 *                        same `scoreFartlekCandidate` pipeline used for OSM imports. Only
 *                        AUTO_PUBLISH candidates are written; REVIEW/IGNORE/REJECT candidates
 *                        are reported but skipped (review candidates need a name assigned
 *                        before they can publish — see `fartlekFromScoredCandidate`).
 *
 *   --fartleks <file>    A JSON array of already-built `Fartlek` domain objects (e.g. manually
 *                        curated test segments), upserted as-is without scoring.
 */

interface Arguments {
  dryRun: boolean;
  candidatesFile?: string;
  fartleksFile?: string;
}

const argumentsFrom = (values: string[]): Arguments => {
  const result: Arguments = { dryRun: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--dry-run") result.dryRun = true;
    else if (value === "--candidates" || value === "--fartleks") {
      const argument = values[++index];
      if (!argument || argument.startsWith("--")) throw new Error(`${value} requires a file path.`);
      if (value === "--candidates") result.candidatesFile = path.resolve(argument);
      else result.fartleksFile = path.resolve(argument);
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  if (!result.candidatesFile && !result.fartleksFile) {
    throw new Error("Provide --candidates <file> or --fartleks <file>.");
  }
  if (result.candidatesFile && result.fartleksFile) {
    throw new Error("--candidates and --fartleks cannot be combined.");
  }
  return result;
};

const readJsonArray = async <T>(file: string, label: string): Promise<T[]> => {
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${file} must contain a JSON array of ${label}.`);
  return parsed as T[];
};

const fromCandidates = (candidates: FartlekCandidate[]): { toPublish: Fartlek[]; report: string[] } => {
  const report: string[] = [];
  const toPublish: Fartlek[] = [];
  for (const candidate of candidates) {
    const scored = scoreFartlekCandidate(candidate);
    if (scored.decision !== "AUTO_PUBLISH") {
      report.push(
        `SKIP ${candidate.id} (${scored.decision}, score=${scored.suitabilityScore}, ` +
          `mappingConfidence=${scored.mappingConfidence}): ${scored.rejectionReason ?? scored.reasons.join("; ")}`
      );
      continue;
    }
    if (!candidate.name) {
      report.push(`SKIP ${candidate.id} (AUTO_PUBLISH but missing a name; assign one before publishing)`);
      continue;
    }
    toPublish.push(fartlekFromScoredCandidate(scored));
    report.push(`PUBLISH ${candidate.id} -> ${candidate.name} (score=${scored.suitabilityScore})`);
  }
  return { toPublish, report };
};

const run = async (): Promise<void> => {
  const args = argumentsFrom(process.argv.slice(2));
  let toPublish: Fartlek[];
  if (args.candidatesFile) {
    const candidates = await readJsonArray<FartlekCandidate>(args.candidatesFile, "FartlekCandidate objects");
    const result = fromCandidates(candidates);
    for (const line of result.report) console.log(line);
    toPublish = result.toPublish;
  } else {
    toPublish = await readJsonArray<Fartlek>(args.fartleksFile!, "Fartlek objects");
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
