import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { normalizeCollectibles } from "../coin.js";
import { config } from "../config.js";
import { createDatabasePool } from "./database.js";
import { migrate } from "./migrate.js";
import { CollectibleRepository } from "./collectibleRepository.js";
import { QuestRepository } from "./questRepository.js";
import { QuestInstanceRepository, readQuestTemplateRows } from "./questInstanceRepository.js";
import type { Collectible } from "../domain.js";
import path from "node:path";

interface SeedDocument {
  collectibles: Collectible[];
  curatorDisplayName: string;
  removeQuests: string[];
}

const readQuestTitles = (value: unknown, field: string): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((title): title is string =>
    typeof title === "string" && title.trim() !== "")) {
    throw new Error(`${field} must be a list of nonblank quest titles.`);
  }
  return [...new Set(value.map((title) => title.trim()))];
};

const readSeedDocument = async (file: string): Promise<SeedDocument> => {
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  if (Array.isArray(parsed)) {
    return {
      collectibles: normalizeCollectibles(parsed),
      curatorDisplayName: "Staza Curator",
      removeQuests: []
    };
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`${file} must contain a collectible array or a seed document.`);
  }
  const document = parsed as Record<string, unknown>;
  if (document.quests !== undefined
    && (!Array.isArray(document.quests) || document.quests.length > 0)) {
    throw new Error("Quest rows are no longer seeded; curate quest templates in fixtures/quest-templates.json.");
  }
  const curator = document.curator as { displayName?: unknown } | undefined;
  return {
    collectibles: normalizeCollectibles(document.collectibles),
    curatorDisplayName: typeof curator?.displayName === "string" ? curator.displayName : "Staza Curator",
    removeQuests: readQuestTitles(document.removeQuests, "removeQuests")
  };
};

const ensureCurator = async (pool: Pool, displayName: string): Promise<string> => {
  const existing = await pool.query<{ id: string }>(
    "SELECT id FROM players WHERE display_name = $1 ORDER BY created_at LIMIT 1",
    [displayName]
  );
  if (existing.rowCount === 1) return existing.rows[0].id;
  const id = randomUUID();
  await pool.query("INSERT INTO players (id, display_name) VALUES ($1, $2)", [id, displayName]);
  return id;
};

const removeSeedQuests = async (pool: Pool, curatorId: string, titles: string[]): Promise<number> => {
  return new QuestRepository(pool).removeOwnedByTitles(curatorId, titles);
};

const file = process.argv[2] ?? config.collectibleSeedFile;

if (!config.databaseUrl) throw new Error("DATABASE_URL is required.");

const pool = createDatabasePool(config.databaseUrl);
try {
  await migrate(pool);
  const document = await readSeedDocument(file);
  const templates = await readQuestTemplateRows(path.resolve("fixtures/quest-templates.json"));
  await new QuestInstanceRepository(pool).replaceTemplates(templates);
  const count = await new CollectibleRepository(pool).upsertMany(document.collectibles);
  const hasRetiredQuests = document.removeQuests.length > 0;
  const curatorId = hasRetiredQuests ? await ensureCurator(pool, document.curatorDisplayName) : undefined;
  const removedQuestCount = curatorId === undefined
    ? 0
    : await removeSeedQuests(pool, curatorId, document.removeQuests);
  console.log(`Seeded ${count} collectibles and ${templates.length} quest templates; removed ${removedQuestCount} retired quests from ${file}.`);
} finally {
  await pool.end();
}
