import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  Activity,
  ActivityType,
  ActivityImportResult,
  ActivityHistoryItem,
  ActivityResult,
  ActivityVideo,
  ActivityVideoState,
  PersistedActivity,
  PersistedActivityEvent,
  ProgressDashboard,
  PlayerProgress,
  PlayerProfileOverview,
  ReplaySnapshot
} from "../domain.js";
import { getLevelProgress, getTotalXpRequiredForLevel } from "../progression.js";

interface ActivityRow {
  id: string;
  activity_type: ActivityType;
  started_at: Date;
  distance_meters: number | null;
  duration_seconds: number | null;
  xp_earned: number;
  collected_count: number;
  has_video: boolean;
  replay_snapshot: ReplaySnapshot | null;
}

interface EventRow {
  id: string;
  source_id: string;
  event_type: PersistedActivityEvent["type"];
  activity_timestamp: string | number;
  value: number;
  latitude: number;
  longitude: number;
  collectible_name: string;
  collectible_rarity: PersistedActivityEvent["collectible"]["rarity"] | null;
  collectible_type: PersistedActivityEvent["collectible"]["type"];
}

interface VideoRow {
  media_id: string;
  source_filename: string;
  state: ActivityVideoState;
  source_duration: number | null;
  synchronization: ActivityVideo["synchronization"] | null;
  mapped_events: ActivityVideo["events"] | null;
  selected_source_ids: string[] | null;
  render: ActivityVideo["render"] | null;
  output_path: string | null;
  error: string | null;
}

interface ProgressLifetimeRow {
  distance_meters: number;
  total_collectibles: string;
  rare_or_better_collectibles: string;
}

const mapActivity = (row: ActivityRow): ActivityHistoryItem => ({
  id: row.id,
  type: row.activity_type,
  startedAt: row.started_at.toISOString(),
  ...(row.distance_meters === null ? {} : { distanceMeters: row.distance_meters }),
  ...(row.duration_seconds === null ? {} : { durationSeconds: row.duration_seconds }),
  xpEarned: row.xp_earned,
  collectedCount: row.collected_count,
  hasVideo: row.has_video
});

const createReplaySnapshot = (activity: Activity, activityResult: ActivityResult): ReplaySnapshot => ({
  version: 1,
  activity: structuredClone(activity),
  activityResult: structuredClone(activityResult)
});

const mapEvent = (row: EventRow): PersistedActivityEvent => ({
  id: row.id,
  sourceId: row.source_id,
  type: row.event_type,
  collectible: {
    name: row.collectible_name,
    type: row.collectible_type,
    ...(row.collectible_rarity === null ? {} : { rarity: row.collectible_rarity })
  },
  value: row.value,
  latitude: row.latitude,
  longitude: row.longitude,
  activityTimestamp: Number(row.activity_timestamp)
});

const mapVideo = (row: VideoRow): ActivityVideo => ({
  mediaId: row.media_id,
  sourceFilename: row.source_filename,
  state: row.state,
  ...(row.source_duration === null ? {} : { sourceDuration: row.source_duration }),
  ...(row.synchronization === null ? {} : { synchronization: row.synchronization }),
  ...(row.mapped_events === null ? {} : { events: row.mapped_events }),
  ...(row.selected_source_ids === null ? {} : { selectedSourceIds: row.selected_source_ids }),
  ...(row.render === null ? {} : { render: row.render }),
  ...(row.error === null ? {} : { error: row.error })
});

export class ActivityRepository {
  constructor(private readonly pool: Pool) {}

  async persistCompletedActivity(
    playerId: string,
    activity: Activity,
    result: ActivityResult,
    importKey?: string
  ): Promise<{ activity: PersistedActivity; progress: PlayerProgress; inserted: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query<ActivityRow>(
        `INSERT INTO activities (
          id, player_id, source_type, activity_type, started_at, distance_meters, duration_seconds, xp_earned, collected_count,
          replay_snapshot, source_external_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT DO NOTHING
        RETURNING id, activity_type, started_at, distance_meters, duration_seconds, xp_earned, collected_count, has_video, replay_snapshot`,
        [
          activity.id,
          playerId,
          activity.source,
          activity.type,
          new Date(activity.startedAt),
          activity.distance ?? null,
          activity.duration ?? null,
          result.totalPoints,
          result.collectedCount,
          JSON.stringify(createReplaySnapshot(activity, result)),
          importKey ?? null
        ]
      );

      if (inserted.rowCount === 0) {
        const persisted = await this.getActivityWithClient(
          client, playerId,
          importKey
            ? await this.getActivityIdByImportKeyWithClient(client, playerId, importKey)
            : activity.id
        );
        const progress = await this.getProgressWithClient(client, playerId);
        await client.query("COMMIT");
        return { activity: persisted, progress, inserted: false };
      }

      for (const event of result.events) {
        await client.query(
          `INSERT INTO activity_events (
            id, activity_id, source_id, event_type, activity_timestamp, value, latitude, longitude,
            collectible_name, collectible_rarity, collectible_type
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            randomUUID(),
            activity.id,
            event.sourceId,
            event.type,
            event.activityTimestamp,
            event.value,
            event.latitude,
            event.longitude,
            event.collectible.name,
            event.collectible.rarity ?? null,
            event.collectible.type
          ]
        );
      }
      const player = await client.query<{ total_xp: number }>(
        "UPDATE players SET total_xp = total_xp + $1 WHERE id = $2 RETURNING total_xp",
        [result.totalPoints, playerId]
      );
      if (player.rowCount !== 1) throw new Error("Default player does not exist.");
      const persisted = await this.getActivityWithClient(client, playerId, activity.id);
      await client.query("COMMIT");
      return { activity: persisted, progress: getLevelProgress(player.rows[0].total_xp), inserted: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getActivityByImportKey(playerId: string, importKey: string): Promise<PersistedActivity | undefined> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT id FROM activities
       WHERE player_id = $1 AND source_type = 'fit' AND source_external_id = $2`,
      [playerId, importKey]
    );
    if (result.rowCount !== 1) return undefined;
    return this.getActivity(playerId, result.rows[0].id);
  }

  async listActivities(playerId: string): Promise<ActivityHistoryItem[]> {
    const result = await this.pool.query<ActivityRow>(
      `SELECT id, activity_type, started_at, distance_meters, duration_seconds, xp_earned, collected_count, has_video, replay_snapshot
       FROM activities WHERE player_id = $1 ORDER BY created_at DESC, id DESC`,
      [playerId]
    );
    return result.rows.map(mapActivity);
  }

  async getActivity(playerId: string, id: string): Promise<PersistedActivity | undefined> {
    const client = await this.pool.connect();
    try {
      return await this.getActivityWithClient(client, playerId, id);
    } catch (error) {
      if (error instanceof Error && error.message === "Activity not found.") return undefined;
      throw error;
    } finally {
      client.release();
    }
  }

  async getProgress(playerId: string): Promise<PlayerProgress> {
    const result = await this.pool.query<{ total_xp: number }>(
      "SELECT total_xp FROM players WHERE id = $1",
      [playerId]
    );
    if (result.rowCount !== 1) throw new Error("Default player does not exist.");
    return getLevelProgress(result.rows[0].total_xp);
  }

  async getProfileOverview(playerId: string): Promise<PlayerProfileOverview> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const player = await client.query<{ display_name: string; total_xp: number }>(
        "SELECT display_name, total_xp FROM players WHERE id = $1",
        [playerId]
      );
      if (player.rowCount !== 1) throw new Error("Player does not exist.");
      const lifetime = await client.query<{ distance_meters: number; activity_count: string }>(
        `SELECT COALESCE(SUM(distance_meters), 0) AS distance_meters, COUNT(*) AS activity_count
         FROM activities WHERE player_id = $1`,
        [playerId]
      );
      await client.query("COMMIT");
      return {
        displayName: player.rows[0].display_name,
        progress: getLevelProgress(player.rows[0].total_xp),
        distanceMeters: Number(lifetime.rows[0].distance_meters),
        activityCount: Number(lifetime.rows[0].activity_count)
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getProgressDashboard(playerId: string): Promise<ProgressDashboard> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const progress = await this.getProgressWithClient(client, playerId);
      const lifetimeResult = await client.query<ProgressLifetimeRow>(
        `SELECT
           COALESCE((
             SELECT SUM(distance_meters)
             FROM activities
             WHERE player_id = $1
           ), 0) AS distance_meters,
           COUNT(DISTINCT events.source_id) AS total_collectibles,
           COUNT(DISTINCT events.source_id) FILTER (
             WHERE events.collectible_rarity IN ('rare', 'epic')
           ) AS rare_or_better_collectibles
         FROM activity_events AS events
         INNER JOIN activities ON activities.id = events.activity_id
         WHERE activities.player_id = $1`,
        [playerId]
      );
      const recentActivitiesResult = await client.query<ActivityRow>(
        `SELECT id, activity_type, started_at, distance_meters, duration_seconds, xp_earned, collected_count, has_video, replay_snapshot
         FROM activities
         WHERE player_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT 4`,
        [playerId]
      );
      await client.query("COMMIT");
      const lifetime = lifetimeResult.rows[0];
      const firstLevel = Math.max(1, progress.level - 2);
      const lastLevel = progress.level + 3;

      return {
        progress,
        lifetime: {
          distanceMeters: Number(lifetime.distance_meters),
          totalCollectibles: Number(lifetime.total_collectibles),
          rareOrBetterCollectibles: Number(lifetime.rare_or_better_collectibles)
        },
        levels: Array.from({ length: lastLevel - firstLevel + 1 }, (_, index) => {
          const level = firstLevel + index;
          return { level, totalXpRequired: getTotalXpRequiredForLevel(level) };
        }),
        recentActivities: recentActivitiesResult.rows.map(mapActivity)
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listDiscoveredCollectibleSourceIds(playerId: string): Promise<string[]> {
    const result = await this.pool.query<{ source_id: string }>(
      `SELECT DISTINCT events.source_id
       FROM activity_events AS events
       INNER JOIN activities ON activities.id = events.activity_id
       WHERE activities.player_id = $1
       ORDER BY events.source_id`,
      [playerId]
    );
    return result.rows.map((row) => row.source_id);
  }

  async markActivityHasVideo(playerId: string, id: string): Promise<void> {
    const result = await this.pool.query(
      "UPDATE activities SET has_video = true WHERE id = $1 AND player_id = $2",
      [id, playerId]
    );
    if (result.rowCount !== 1) throw new Error("Persisted activity not found.");
  }

  async createActivityVideo(playerId: string, activityId: string, mediaId: string, sourceFilename: string, sourcePath: string): Promise<ActivityVideo> {
    const result = await this.pool.query<VideoRow>(
      `INSERT INTO activity_videos (activity_id, media_id, source_filename, source_path, state)
       SELECT id, $2, $3, $4, 'syncing' FROM activities WHERE id = $1 AND player_id = $5
       ON CONFLICT (activity_id) DO NOTHING
       RETURNING media_id, source_filename, state, source_duration, synchronization, mapped_events, selected_source_ids, render, output_path, error`,
      [activityId, mediaId, sourceFilename, sourcePath, playerId]
    );
    if (result.rowCount === 1) return mapVideo(result.rows[0]);
    const activity = await this.getActivity(playerId, activityId);
    if (!activity) throw new Error("Activity not found.");
    if (activity.video) throw new Error("A video is already attached to this activity. Replacing it is not supported.");
    throw new Error("Could not attach video.");
  }

  async updateActivityVideo(playerId: string, activityId: string, video: ActivityVideo, sourcePath?: string, outputPath?: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE activity_videos SET state = $2, source_duration = $3, synchronization = $4, mapped_events = $5,
       selected_source_ids = $6, render = $7, output_path = COALESCE($8, output_path), error = $9, updated_at = now()
       WHERE activity_id = $1 AND EXISTS (SELECT 1 FROM activities WHERE activities.id = activity_videos.activity_id AND activities.player_id = $10)`,
      [activityId, video.state, video.sourceDuration ?? null, video.synchronization ? JSON.stringify(video.synchronization) : null,
        video.events ? JSON.stringify(video.events) : null, video.selectedSourceIds ? JSON.stringify(video.selectedSourceIds) : null,
        video.render ? JSON.stringify(video.render) : null, outputPath ?? sourcePath ?? null, video.error ?? null, playerId]
    );
    if (result.rowCount !== 1) throw new Error("Activity video not found.");
  }

  async markInterruptedActivityVideos(): Promise<void> {
    await this.pool.query(
      `UPDATE activity_videos
       SET state = CASE WHEN state = 'rendering' THEN 'render_failed' ELSE 'sync_failed' END,
           error = 'Video processing was interrupted by a server restart.',
           updated_at = now()
       WHERE state IN ('syncing', 'rendering')`
    );
  }

  async getActivityVideoPaths(playerId: string, activityId: string): Promise<{ sourcePath: string; outputPath?: string } | undefined> {
    const result = await this.pool.query<{ source_path: string; output_path: string | null }>(
      `SELECT source_path, output_path FROM activity_videos
       INNER JOIN activities ON activities.id = activity_videos.activity_id
       WHERE activity_id = $1 AND activities.player_id = $2`, [activityId, playerId]
    );
    if (result.rowCount !== 1) return undefined;
    return { sourcePath: result.rows[0].source_path, ...(result.rows[0].output_path ? { outputPath: result.rows[0].output_path } : {}) };
  }

  async removeRetryableActivityVideo(playerId: string, activityId: string): Promise<string | undefined> {
    const result = await this.pool.query<{ source_path: string }>(
      `DELETE FROM activity_videos AS video
       USING activities
       WHERE video.activity_id = activities.id
         AND video.activity_id = $1
         AND activities.player_id = $2
         AND video.state IN ('sync_failed', 'no_highlights')
       RETURNING video.source_path`,
      [activityId, playerId]
    );
    return result.rows[0]?.source_path;
  }

  private async getProgressWithClient(client: PoolClient, playerId: string): Promise<PlayerProgress> {
    const result = await client.query<{ total_xp: number }>(
      "SELECT total_xp FROM players WHERE id = $1",
      [playerId]
    );
    if (result.rowCount !== 1) throw new Error("Default player does not exist.");
    return getLevelProgress(result.rows[0].total_xp);
  }

  private async getActivityIdByImportKeyWithClient(client: PoolClient, playerId: string, importKey: string): Promise<string> {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM activities
       WHERE player_id = $1 AND source_type = 'fit' AND source_external_id = $2`,
      [playerId, importKey]
    );
    if (result.rowCount !== 1) throw new Error("Persisted import not found.");
    return result.rows[0].id;
  }

  private async getActivityWithClient(client: PoolClient, playerId: string, id: string): Promise<PersistedActivity> {
    const activityResult = await client.query<ActivityRow>(
      `SELECT id, activity_type, started_at, distance_meters, duration_seconds, xp_earned, collected_count, has_video, replay_snapshot
       FROM activities WHERE id = $1 AND player_id = $2`,
      [id, playerId]
    );
    if (activityResult.rowCount !== 1) throw new Error("Activity not found.");
    const events = await client.query<EventRow>(
      `SELECT id, source_id, event_type, activity_timestamp, value, latitude, longitude,
              collectible_name, collectible_rarity, collectible_type
       FROM activity_events WHERE activity_id = $1 ORDER BY activity_timestamp, id`,
      [id]
    );
    const video = await client.query<VideoRow>(
      `SELECT media_id, source_filename, state, source_duration, synchronization, mapped_events, selected_source_ids, render, output_path, error
       FROM activity_videos WHERE activity_id = $1`, [id]
    );
    return {
      ...mapActivity(activityResult.rows[0]),
      events: events.rows.map(mapEvent),
      ...(activityResult.rows[0].replay_snapshot === null ? {} : { replay: activityResult.rows[0].replay_snapshot }),
      ...(video.rowCount === 1 ? { video: mapVideo(video.rows[0]) } : {})
    };
  }
}
