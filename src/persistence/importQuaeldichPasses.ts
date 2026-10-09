import { config } from "../config.js";
import { createDatabasePool } from "./database.js";
import { migrate } from "./migrate.js";
import { CollectibleRepository } from "./collectibleRepository.js";
import { fetchQuaeldichGeoJson } from "../quaeldich/fetchGeoJson.js";
import { normalizeQuaeldichCollection, QUAELDICH_SOURCE_TYPE } from "../quaeldich/normalize.js";
import { planQuaeldichImport, formatImportReport } from "../quaeldich/import.js";

const dryRun = process.argv.includes("--dry-run");

if (!config.databaseUrl) throw new Error("DATABASE_URL is required.");

const pool = createDatabasePool(config.databaseUrl);
try {
  if (!dryRun) await migrate(pool);
  const repository = new CollectibleRepository(pool);

  const payload = await fetchQuaeldichGeoJson(config.quaeldichGeoJsonUrl);
  const batch = normalizeQuaeldichCollection(payload, {
    radiusMeters: config.mountainPassDefaultRadiusMeters
  });

  const all = await repository.listAll();
  const existingSource = all.filter((c) => c.source?.sourceType === QUAELDICH_SOURCE_TYPE);
  const otherCollectibles = all.filter((c) => c.source === undefined);

  const plan = planQuaeldichImport({ batch, existingSource, otherCollectibles });

  if (!dryRun) {
    await repository.upsertMany([...plan.created, ...plan.updated]);
  }

  console.log(formatImportReport(plan, { sourceUrl: config.quaeldichGeoJsonUrl, dryRun }));
} finally {
  await pool.end();
}
