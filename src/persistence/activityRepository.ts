import { buildActivityQuestMetrics, resolveAuthoredQuestAttemptsWithClient } from "./authoredQuestRepository.js";
import { buildActivityOutcome, readSkillTreeView } from "./activityOutcome.js";
import { resolveExplorationAttemptsWithClient } from "./questInstanceRepository.js";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { activityTypeLabel } from "../activity.js";
import type {
  Activity,
  ActivitySource,
  ActivityType,
  CollectibleCategory,
  ActivityHistoryItem,
  ActivityOutcome,
  ActivityResult,
  ActivityVideo,
  ActivityVideoState,
  PersistedActivity,
  PersistedActivityEvent,
  ProgressDashboard,
  PlayerProgress,
  PlayerProfileOverview,
  QuestDifficulty,
  QuestHistoryEntry,
  ReplaySnapshot
} from "../domain.js";
import { AUTHORED_QUEST_CHAINS, findAuthoredQuest } from "../authoredQuests/catalog.js";
import {
  createActivityFingerprint,
  FINGERPRINT_CANDIDATE_WINDOW_MS,
  isHighConfidenceDuplicate,
  type ActivityFingerprint
} from "../activityFingerprint.js";
import { readableFlowlineName } from "../flowlineName.js";
import { ActivityImportRejectedError } from "../errors.js";
import { getLevelProgress, getTotalXpRequiredForLevel } from "../progression.js";
import { FartlekCompletionRepository } from "./fartlekCompletionRepository.js";
import type { SkillTreeStats } from "../skillTree/types.js";
import { earnedSkillPointsForLevel } from "../skillTree/catalog.js";
import { aggregateSkillTreeStats } from "../skillTree/statsQuery.js";

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
  title: string | null;
  revisit_count: string | number;
  flowline_count: string | number;
}

/** Columns shared by every activity query; list queries skip the heavy replay snapshot. */
const activityColumns = (includeSnapshot: boolean): string => `
  activities.id, activity_type, started_at, distance_meters, duration_seconds, xp_earned, collected_count, has_video,
  ${includeSnapshot ? "replay_snapshot" : "NULL::jsonb AS replay_snapshot"},
  replay_snapshot->'activity'->>'title' AS title,
  (SELECT COUNT(*) FROM activity_events e WHERE e.activity_id = activities.id AND e.repeat) AS revisit_count,
  (SELECT COUNT(*) FROM fartlek_completions f WHERE f.activity_id = activities.id) AS flowline_count`;

interface EventRow {
  id: string;
  source_id: string;
  event_type: PersistedActivityEvent["type"];
  activity_timestamp: string | number;
  value: number;
  latitude: number;
  longitude: number;
  collectible_name: string;
  collectible_type: PersistedActivityEvent["collectible"]["type"];
  collectible_category: CollectibleCategory | null;
  repeat: boolean;
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
  total_flowlines: string;
}

const mapActivity = (row: ActivityRow): ActivityHistoryItem => ({
  id: row.id,
  type: row.activity_type,
  title: row.title?.trim() || activityTypeLabel(row.activity_type),
  startedAt: row.started_at.toISOString(),
  revisitCount: Number(row.revisit_count),
  flowlineCount: Number(row.flowline_count),
  ...(row.distance_meters === null ? {} : { distanceMeters: row.distance_meters }),
  ...(row.duration_seconds === null ? {} : { durationSeconds: row.duration_seconds }),
  xpEarned: row.xp_earned,
  collectedCount: row.collected_count,
  hasVideo: row.has_video
});

const createReplaySnapshot = (
  activity: Activity,
  activityResult: ActivityResult,
  outcome?: ActivityOutcome
): ReplaySnapshot => ({
  version: 1,
  activity: structuredClone(activity),
  activityResult: structuredClone(activityResult),
  ...(outcome ? { outcome } : {})
});

/** Snapshots stored before name cleanup still carry raw OSM names. */
const withReadableFlowlineNames = (snapshot: ReplaySnapshot): ReplaySnapshot => ({
  ...snapshot,
  activityResult: {
    ...snapshot.activityResult,
    fartlekCompletions: snapshot.activityResult.fartlekCompletions.map((completion) => ({
      ...completion,
      fartlekName: readableFlowlineName(completion.fartlekName)
    }))
  }
});

/**
 * A collectible already claimed by the player earlier is a revisit: it stays in the replay and
 * result card but grants no XP and no longer counts as a new collectible.
 */
const resolveCollectibleClaims = (result: ActivityResult, claimedSourceIds: ReadonlySet<string>): ActivityResult => {
  const events = result.events.map((event) =>
    claimedSourceIds.has(event.sourceId) ? { ...event, value: 0, repeat: true } : { ...event, repeat: false }
  );
  const lostXp = result.events.reduce((total, event, index) => total + event.value - events[index].value, 0);
  const revisitCount = events.filter((event) => event.repeat).length;
  return {
    ...result,
    events,
    collectedCount: events.length - revisitCount,
    revisitCount,
    totalPoints: result.totalPoints - lostXp
  };
};

const mapEvent = (row: EventRow): PersistedActivityEvent => ({
  id: row.id,
  sourceId: row.source_id,
  type: row.event_type,
  collectible: {
    name: row.collectible_name,
    type: row.collectible_type
  },
  ...(row.collectible_category === null ? {} : { collectibleCategory: row.collectible_category }),
  value: row.value,
  latitude: row.latitude,
  longitude: row.longitude,
  activityTimestamp: Number(row.activity_timestamp),
  ...(row.repeat ? { repeat: true } : {})
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
  private readonly fartlekCompletionRepository: FartlekCompletionRepository;

  constructor(private readonly pool: Pool) {
    this.fartlekCompletionRepository = new FartlekCompletionRepository(pool);
  }

  async persistCompletedActivity(
    playerId: string,
    activity: Activity,
    submittedResult: ActivityResult,
    importKey?: string
  ): Promise<{ activity: PersistedActivity; progress: PlayerProgress; inserted: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // The player row lock serializes every acceptance decision for this player: exact identity,
      // cross-source duplicates, and the journey boundary are evaluated against committed state.
      const player = await client.query<{ created_at: Date; total_xp: number }>(
        "SELECT created_at, total_xp FROM players WHERE id = $1 FOR UPDATE",
        [playerId]
      );
      if (player.rowCount !== 1) throw new Error("Default player does not exist.");

      const existingId = importKey
        ? await this.findActivityIdByImportKeyWithClient(client, playerId, activity.source, importKey)
        : await this.findOwnedActivityIdWithClient(client, playerId, activity.id);
      if (existingId) {
        const persisted = await this.getActivityWithClient(client, playerId, existingId);
        const progress = await this.getProgressWithClient(client, playerId);
        await client.query("COMMIT");
        return { activity: persisted, progress, inserted: false };
      }

      const fingerprint = createActivityFingerprint(activity);
      if (fingerprint) {
        const duplicateId = await this.findCrossSourceDuplicateWithClient(client, playerId, activity.source, fingerprint);
        if (duplicateId) {
          throw new ActivityImportRejectedError(
            "duplicate_activity",
            "This activity is already in Staza from another import.",
            { existingActivityId: duplicateId }
          );
        }
      }

      // The journey starts at account creation, for every import source.
      const journeyStartedAt = player.rows[0].created_at;
      if (activity.startedAt < journeyStartedAt.getTime()) {
        throw new ActivityImportRejectedError(
          "before_journey_start",
          "This activity happened before your Staza account was created.",
          { journeyStartedAt: journeyStartedAt.toISOString() }
        );
      }

      const submittedSourceIds = [...new Set(submittedResult.events.map((event) => event.sourceId))];
      const claimed = await client.query<{ source_id: string }>(
        `SELECT DISTINCT events.source_id FROM activity_events AS events
         INNER JOIN activities ON activities.id = events.activity_id
         WHERE activities.player_id = $1 AND events.source_id = ANY($2::text[])`,
        [playerId, submittedSourceIds]
      );
      const result = resolveCollectibleClaims(submittedResult, new Set(claimed.rows.map((row) => row.source_id)));
      const knownFlowlines = await client.query<{ fartlek_id: string }>(
        "SELECT DISTINCT fartlek_id FROM fartlek_completions WHERE player_id = $1 AND fartlek_id = ANY($2::text[])",
        [playerId, result.fartlekCompletions.map((completion) => completion.fartlekId)]
      );
      const newFlowlineCount = new Set(result.fartlekCompletions.map((completion) => completion.fartlekId)).size
        - knownFlowlines.rowCount!;
      const skillTreeBefore = await readSkillTreeView(client, playerId);

      const inserted = await client.query<ActivityRow>(
        `INSERT INTO activities (
          id, player_id, source_type, activity_type, started_at, distance_meters, duration_seconds, xp_earned, collected_count,
          replay_snapshot, source_external_id, fingerprint_version, fingerprint_started_at, fingerprint, elevation_gain_m
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT DO NOTHING
        RETURNING id`,
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
          importKey ?? null,
          fingerprint?.version ?? null,
          fingerprint ? new Date(fingerprint.startedAtMs) : null,
          fingerprint ? JSON.stringify(fingerprint) : null,
          activity.elevationGainM ?? null
        ]
      );
      if (inserted.rowCount === 0) throw new Error("Activity identity conflict.");

      const eventSourceIds = [...new Set(result.events.map((event) => event.sourceId))];
      const eventCategories = await client.query<{
        id: string;
        primary_category: CollectibleCategory | null;
      }>(
        "SELECT id, primary_category FROM collectibles WHERE id = ANY($1::text[])",
        [eventSourceIds]
      );
      const categoriesBySourceId = new Map(eventCategories.rows.map((row) => [row.id, row.primary_category]));
      for (const event of result.events) {
        await client.query(
          `INSERT INTO activity_events (
            id, activity_id, source_id, event_type, activity_timestamp, value, latitude, longitude,
            collectible_name, collectible_type, collectible_category, repeat
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
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
            event.collectible.type,
            categoriesBySourceId.get(event.sourceId) ?? null,
            event.repeat === true
          ]
        );
      }
      if (result.fartlekCompletions.length > 0) {
        await this.fartlekCompletionRepository.insertManyWithClient(
          client, playerId, activity.id, result.fartlekCompletions
        );
      }
      const activityStartedAt = new Date(activity.startedAt);
      const authoredOutcomes = await resolveAuthoredQuestAttemptsWithClient(
        client, playerId, activity.id, activityStartedAt, buildActivityQuestMetrics(activity, result, categoriesBySourceId)
      );
      const explorationOutcomes = await resolveExplorationAttemptsWithClient(client, playerId, activity.id, activityStartedAt, {
        collectibles: result.events.map((event) => {
          const category = categoriesBySourceId.get(event.sourceId);
          return { sourceId: event.sourceId, ...(category ? { category } : {}) };
        }),
        flowlines: result.fartlekCompletions.map((completion) => ({
          flowlineId: completion.fartlekId,
          lengthMeters: completion.fartlekLengthMSnapshot,
          averageSpeedMps: completion.averageSpeedMps
        }))
      });
      const quests = [...authoredOutcomes, ...explorationOutcomes];
      const questXp = quests.reduce((total, quest) => total + quest.xp, 0);
      const updatedPlayer = await client.query<{ total_xp: number }>(
        `UPDATE players
         SET total_xp = total_xp + $1
         WHERE id = $2 RETURNING total_xp`,
        [result.totalPoints + questXp, playerId]
      );
      if (updatedPlayer.rowCount !== 1) throw new Error("Default player does not exist.");
      const skillTreeAfter = await readSkillTreeView(client, playerId);
      const outcome = buildActivityOutcome({
        result,
        previousTotalXp: player.rows[0].total_xp,
        newTotalXp: updatedPlayer.rows[0].total_xp,
        newFlowlineCount,
        quests,
        skillTreeBefore,
        skillTreeAfter
      });
      await client.query("UPDATE activities SET replay_snapshot = $2 WHERE id = $1", [
        activity.id,
        JSON.stringify(createReplaySnapshot(activity, result, outcome))
      ]);
      const persisted = await this.getActivityWithClient(client, playerId, activity.id);
      await client.query("COMMIT");
      return { activity: persisted, progress: getLevelProgress(updatedPlayer.rows[0].total_xp), inserted: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getActivityByImportKey(
    playerId: string,
    importKey: string,
    source: ActivitySource = "fit"
  ): Promise<PersistedActivity | undefined> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT id FROM activities
       WHERE player_id = $1 AND source_type = $2 AND source_external_id = $3`,
      [playerId, source, importKey]
    );
    if (result.rowCount !== 1) return undefined;
    return this.getActivity(playerId, result.rows[0].id);
  }

  /** Maps already-imported provider identities to their Staza activity IDs for one player and source. */
  async listActivityIdsByImportKeys(
    playerId: string,
    source: ActivitySource,
    importKeys: string[]
  ): Promise<Map<string, string>> {
    if (importKeys.length === 0) return new Map();
    const result = await this.pool.query<{ id: string; source_external_id: string }>(
      `SELECT id, source_external_id FROM activities
       WHERE player_id = $1 AND source_type = $2 AND source_external_id = ANY($3::text[])`,
      [playerId, source, importKeys]
    );
    return new Map(result.rows.map((row) => [row.source_external_id, row.id]));
  }

  /** The journey starts at account creation; earlier activities are never importable. */
  async getJourneyStartedAt(playerId: string): Promise<Date> {
    const result = await this.pool.query<{ created_at: Date }>(
      "SELECT created_at FROM players WHERE id = $1",
      [playerId]
    );
    if (result.rowCount !== 1) throw new Error("Player does not exist.");
    return result.rows[0].created_at;
  }

  async listActivities(playerId: string): Promise<ActivityHistoryItem[]> {
    const result = await this.pool.query<ActivityRow>(
      `SELECT ${activityColumns(false)}
       FROM activities WHERE player_id = $1 ORDER BY started_at DESC, id DESC`,
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

  /** Corrects the sport of an owned activity, keeping the replay snapshot, fallback title and fingerprint in step. */
  async updateActivityType(
    playerId: string,
    id: string,
    type: ActivityType
  ): Promise<PersistedActivity | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{ activity_type: ActivityType; replay_snapshot: ReplaySnapshot | null }>(
        "SELECT activity_type, replay_snapshot FROM activities WHERE id = $1 AND player_id = $2 FOR UPDATE",
        [id, playerId]
      );
      if (current.rowCount !== 1) {
        await client.query("ROLLBACK");
        return undefined;
      }
      const previousType = current.rows[0].activity_type;
      const snapshot = current.rows[0].replay_snapshot;
      if (snapshot?.activity) {
        // Only generated fallback titles follow the sport; a title from the device or provider is kept.
        if (snapshot.activity.title === activityTypeLabel(previousType)) {
          snapshot.activity.title = activityTypeLabel(type);
        }
        snapshot.activity.type = type;
      }
      await client.query(
        `UPDATE activities
         SET activity_type = $3,
             replay_snapshot = $4,
             fingerprint = CASE WHEN fingerprint IS NULL THEN NULL
               ELSE jsonb_set(fingerprint, '{activityType}', to_jsonb($3::text)) END
         WHERE id = $1 AND player_id = $2`,
        [id, playerId, type, snapshot === null ? null : JSON.stringify(snapshot)]
      );
      const persisted = await this.getActivityWithClient(client, playerId, id);
      await client.query("COMMIT");
      return persisted;
    } catch (error) {
      await client.query("ROLLBACK");
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
      const lifetime = await client.query<{ distance_meters: number; activity_count: string; flowline_count: string }>(
        `SELECT COALESCE(SUM(distance_meters), 0) AS distance_meters, COUNT(*) AS activity_count,
                (SELECT COUNT(DISTINCT fartlek_id) FROM fartlek_completions WHERE player_id = $1) AS flowline_count
         FROM activities WHERE player_id = $1`,
        [playerId]
      );
      await client.query("COMMIT");
      return {
        displayName: player.rows[0].display_name,
        progress: getLevelProgress(player.rows[0].total_xp),
        distanceMeters: Number(lifetime.rows[0].distance_meters),
        activityCount: Number(lifetime.rows[0].activity_count),
        flowlineCount: Number(lifetime.rows[0].flowline_count)
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
           (
             SELECT COUNT(DISTINCT events.source_id)
             FROM activity_events AS events
             INNER JOIN activities ON activities.id = events.activity_id
             WHERE activities.player_id = $1
           ) AS total_collectibles,
           (SELECT COUNT(DISTINCT fartlek_id) FROM fartlek_completions WHERE player_id = $1) AS total_flowlines`,
        [playerId]
      );
      const recentActivitiesResult = await client.query<ActivityRow>(
        `SELECT ${activityColumns(false)}
         FROM activities
         WHERE player_id = $1
         ORDER BY started_at DESC, id DESC
         LIMIT 4`,
        [playerId]
      );
      const questHistoryRows = await client.query<{
        id: string; kind: "authored" | "exploration"; title: string; difficulty: QuestDifficulty | null;
        xp: number; completed_at: Date; activity_id: string | null;
      }>(
        `SELECT quest_id AS id, 'authored' AS kind, quest_id AS title, NULL AS difficulty, xp, completed_at, activity_id
         FROM authored_quest_completions WHERE player_id = $1
         UNION ALL
         SELECT id::text, 'exploration', title, difficulty, reward_xp, completed_at, resolved_activity_id
         FROM quest_instances WHERE player_id = $1 AND status = 'completed'
         ORDER BY completed_at DESC LIMIT 10`,
        [playerId]
      );
      await client.query("COMMIT");
      const questHistory: QuestHistoryEntry[] = questHistoryRows.rows.map((row) => {
        const authored = row.kind === "authored" ? findAuthoredQuest(row.id) : undefined;
        return {
          id: row.id,
          kind: row.kind,
          title: authored?.title ?? row.title,
          ...(authored ? { chainTitle: AUTHORED_QUEST_CHAINS.find((chain) => chain.id === authored.chainId)?.title } : {}),
          difficulty: authored?.difficulty ?? row.difficulty ?? "medium",
          xp: row.xp,
          completedAt: row.completed_at.toISOString(),
          ...(row.activity_id ? { activityId: row.activity_id } : {})
        };
      });
      const lifetime = lifetimeResult.rows[0];
      const firstLevel = Math.max(1, progress.level - 2);
      const lastLevel = progress.level + 3;

      return {
        progress,
        lifetime: {
          distanceMeters: Number(lifetime.distance_meters),
          totalCollectibles: Number(lifetime.total_collectibles),
          totalFlowlines: Number(lifetime.total_flowlines)
        },
        levels: Array.from({ length: lastLevel - firstLevel + 1 }, (_, index) => {
          const level = firstLevel + index;
          return {
            level,
            totalXpRequired: getTotalXpRequiredForLevel(level),
            skillPointsAwarded: earnedSkillPointsForLevel(level) - earnedSkillPointsForLevel(level - 1)
          };
        }),
        recentActivities: recentActivitiesResult.rows.map(mapActivity),
        questHistory
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getSkillTreeStats(playerId: string): Promise<SkillTreeStats> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const stats = await aggregateSkillTreeStats(client, playerId);
      await client.query("COMMIT");
      return stats;
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

  private async findActivityIdByImportKeyWithClient(
    client: PoolClient,
    playerId: string,
    source: ActivitySource,
    importKey: string
  ): Promise<string | undefined> {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM activities
       WHERE player_id = $1 AND source_type = $2 AND source_external_id = $3`,
      [playerId, source, importKey]
    );
    return result.rows[0]?.id;
  }

  private async findOwnedActivityIdWithClient(client: PoolClient, playerId: string, id: string): Promise<string | undefined> {
    const result = await client.query<{ id: string }>(
      "SELECT id FROM activities WHERE id = $1 AND player_id = $2",
      [id, playerId]
    );
    return result.rows[0]?.id;
  }

  private async findCrossSourceDuplicateWithClient(
    client: PoolClient,
    playerId: string,
    source: ActivitySource,
    fingerprint: ActivityFingerprint
  ): Promise<string | undefined> {
    const candidates = await client.query<{ id: string; fingerprint: ActivityFingerprint }>(
      `SELECT id, fingerprint FROM activities
       WHERE player_id = $1 AND source_type <> $2 AND fingerprint_version = $3
         AND fingerprint_started_at BETWEEN $4 AND $5
       ORDER BY created_at, id`,
      [
        playerId,
        source,
        fingerprint.version,
        new Date(fingerprint.startedAtMs - FINGERPRINT_CANDIDATE_WINDOW_MS),
        new Date(fingerprint.startedAtMs + FINGERPRINT_CANDIDATE_WINDOW_MS)
      ]
    );
    return candidates.rows.find((candidate) => isHighConfidenceDuplicate(fingerprint, candidate.fingerprint))?.id;
  }

  private async getActivityWithClient(client: PoolClient, playerId: string, id: string): Promise<PersistedActivity> {
    const activityResult = await client.query<ActivityRow>(
      `SELECT ${activityColumns(true)}
       FROM activities WHERE id = $1 AND player_id = $2`,
      [id, playerId]
    );
    if (activityResult.rowCount !== 1) throw new Error("Activity not found.");
    const events = await client.query<EventRow>(
      `SELECT id, source_id, event_type, activity_timestamp, value, latitude, longitude,
              collectible_name, collectible_type, collectible_category, repeat
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
      ...(activityResult.rows[0].replay_snapshot === null
        ? {}
        : { replay: withReadableFlowlineNames(activityResult.rows[0].replay_snapshot) }),
      ...(video.rowCount === 1 ? { video: mapVideo(video.rows[0]) } : {})
    };
  }
}
