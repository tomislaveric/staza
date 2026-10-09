import { createInterface } from "node:readline/promises";
import { rm } from "node:fs/promises";
import path from "node:path";
import { stdin, stdout } from "node:process";
import { config } from "../config.js";
import { createDatabasePool } from "./database.js";
import { migrate } from "./migrate.js";

interface ActivityVideoRow {
  source_path: string;
}

const mediaDirectoryFor = (sourcePath: string, mediaRoot: string): string => {
  const directory = path.resolve(path.dirname(sourcePath));
  const relative = path.relative(mediaRoot, directory);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Activity video is outside MEDIA_DIR; refusing to remove it: ${sourcePath}`);
  }
  return directory;
};

const cleanActivities = async (): Promise<void> => {
  if (config.nodeEnv === "production") {
    throw new Error("clean:activities is disabled when NODE_ENV=production.");
  }
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required.");

  const mediaRoot = path.resolve(config.mediaDir);
  const databaseHost = new URL(config.databaseUrl).host || "local database";
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await prompt.question(
      `This resets local progress for all players in ${databaseHost}: it deletes all activities, all active and completed quests, quest cancellation markers, and activity video files, then resets XP and journey dates. User accounts, Strava connections, quest templates, collectibles, and Flowlines are preserved. A later Strava sync may import activities again. Type "delete" to continue: `
    );
    if (answer !== "delete") {
      console.log("Activity cleanup cancelled.");
      return;
    }
  } finally {
    prompt.close();
  }

  const pool = createDatabasePool(config.databaseUrl);
  try {
    await migrate(pool);
    const client = await pool.connect();
    let activityCount = 0;
    let questCount = 0;
    let questCancellationCount = 0;
    let mediaDirectories: string[] = [];
    try {
      await client.query("BEGIN");
      const videos = await client.query<ActivityVideoRow>(
        `SELECT video.source_path
         FROM activity_videos AS video
         INNER JOIN activities ON activities.id = video.activity_id`
      );
      mediaDirectories = [...new Set(videos.rows.map((video) => mediaDirectoryFor(video.source_path, mediaRoot)))];

      const deleted = await client.query("DELETE FROM activities");
      activityCount = deleted.rowCount ?? 0;
      const deletedQuests = await client.query("DELETE FROM quest_instances");
      questCount = deletedQuests.rowCount ?? 0;
      const deletedQuestCancellations = await client.query("DELETE FROM quest_instance_cancellations");
      questCancellationCount = deletedQuestCancellations.rowCount ?? 0;
      await client.query("UPDATE players SET total_xp = 0, journey_started_at = NULL");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await Promise.all(mediaDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
    console.log(
      `Deleted ${activityCount} activities, ${questCount} quests, and ${questCancellationCount} quest cancellation markers; reset XP and journey dates for all players.`
    );
  } finally {
    await pool.end();
  }
};

if (process.argv[1]?.includes("cleanActivities.")) {
  await cleanActivities();
}
