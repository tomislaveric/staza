import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { normalizeCollectibles } from "../coin.js";
import { config } from "../config.js";
import { createDatabasePool } from "./database.js";
import { migrate } from "./migrate.js";
import { CollectibleRepository } from "./collectibleRepository.js";
import { QuestRepository } from "./questRepository.js";
import type { Collectible } from "../domain.js";

interface SeedQuest {
  title: string;
  description?: string;
  collectibleIds: string[];
}

interface SeedDocument {
  collectibles: Collectible[];
  curatorDisplayName: string;
  quests: SeedQuest[];
}

const readSeedDocument = async (file: string): Promise<SeedDocument> => {
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  if (Array.isArray(parsed)) {
    return { collectibles: normalizeCollectibles(parsed), curatorDisplayName: "Staza Curator", quests: [] };
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`${file} must contain a collectible array or a seed document.`);
  }
  const document = parsed as Record<string, unknown>;
  const quests = Array.isArray(document.quests) ? (document.quests as SeedQuest[]) : [];
  const curator = document.curator as { displayName?: unknown } | undefined;
  return {
    collectibles: normalizeCollectibles(document.collectibles),
    curatorDisplayName: typeof curator?.displayName === "string" ? curator.displayName : "Staza Curator",
    quests
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

const seedQuests = async (pool: Pool, curatorId: string, quests: SeedQuest[]): Promise<number> => {
  if (quests.length === 0) return 0;
  const repository = new QuestRepository(pool);
  const existing = await pool.query<{ id: string; title: string }>(
    "SELECT id, title FROM quests WHERE created_by_player_id = $1",
    [curatorId]
  );
  const byTitle = new Map(existing.rows.map((row) => [row.title, row.id]));
  for (const quest of quests) {
    const questId = byTitle.get(quest.title);
    if (questId === undefined) {
      const created = await repository.create(curatorId, {
        title: quest.title,
        description: quest.description,
        collectibleIds: quest.collectibleIds
      });
      await repository.setStatus(curatorId, created, "published");
      continue;
    }
    await repository.update(curatorId, questId, {
      title: quest.title,
      description: quest.description ?? "",
      collectibleIds: quest.collectibleIds
    });
    await repository.setStatus(curatorId, questId, "published");
  }
  return quests.length;
};

const file = process.argv[2] ?? config.collectibleSeedFile;

if (!config.databaseUrl) throw new Error("DATABASE_URL is required.");

const pool = createDatabasePool(config.databaseUrl);
try {
  await migrate(pool);
  const document = await readSeedDocument(file);
  const count = await new CollectibleRepository(pool).upsertMany(document.collectibles);
  const curatorId = await ensureCurator(pool, document.curatorDisplayName);
  const questCount = await seedQuests(pool, curatorId, document.quests);
  console.log(`Seeded ${count} collectibles and ${questCount} quests from ${file}.`);
} finally {
  await pool.end();
}
