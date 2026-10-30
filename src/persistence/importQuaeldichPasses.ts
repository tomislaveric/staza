import path from "node:path";
import { config } from "../config.js";
import { createDatabasePool } from "./database.js";
import { migrate } from "./migrate.js";
import { CollectibleRepository } from "./collectibleRepository.js";
import { fetchQuaeldichGeoJson, readQuaeldichGeoJsonFile } from "../quaeldich/fetchGeoJson.js";
import { normalizeQuaeldichCollection, QUAELDICH_SOURCE_TYPE } from "../quaeldich/normalize.js";
import { planQuaeldichImport, formatImportReport } from "../quaeldich/import.js";

const argumentsFrom = (values: string[]): { dryRun: boolean; snapshotFile?: string } => {
  let dryRun = false;
  let snapshotFile: string | undefined;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--dry-run") dryRun = true;
    else if (value === "--snapshot") {
      const file = values[++index];
      if (!file || file.startsWith("--")) throw new Error("--snapshot requires a file path.");
      snapshotFile = path.resolve(file);
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return { dryRun, snapshotFile };
};

const args = argumentsFrom(process.argv.slice(2));

if (!config.databaseUrl) throw new Error("DATABASE_URL is required.");

const pool = createDatabasePool(config.databaseUrl);
try {
  if (!args.dryRun) await migrate(pool);
  const repository = new CollectibleRepository(pool);

  const payload = args.snapshotFile
    ? await readQuaeldichGeoJsonFile(args.snapshotFile)
    : await fetchQuaeldichGeoJson(config.quaeldichGeoJsonUrl);
  const batch = normalizeQuaeldichCollection(payload, {
    radiusMeters: config.mountainPassDefaultRadiusMeters
  });

  const all = await repository.listAll();
  const existingSource = all.filter((c) => c.source?.sourceType === QUAELDICH_SOURCE_TYPE);
  const otherCollectibles = all.filter((c) => c.source === undefined);

  const plan = planQuaeldichImport({ batch, existingSource, otherCollectibles });

  if (!args.dryRun) {
    await repository.upsertMany([...plan.created, ...plan.updated]);
  }

  console.log(formatImportReport(plan, {
    sourceUrl: args.snapshotFile ?? config.quaeldichGeoJsonUrl,
    dryRun: args.dryRun
  }));
} finally {
  await pool.end();
}
