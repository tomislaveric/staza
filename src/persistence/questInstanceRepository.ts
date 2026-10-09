import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import type {
  CollectibleCategory,
  QuestInstance,
  QuestObjective,
  QuestObjectiveTemplate,
  QuestObjectiveState,
  QuestSuggestion,
  QuestTemplate
} from "../domain.js";
import {
  evaluateQuestObjectives,
  isCollectibleCategory,
  validateQuestTemplate,
  type QuestHistory
} from "../questTemplates.js";

interface TemplateRow {
  id: string;
  version: number;
  title: string;
  description: string;
  recommended_level: number;
  objectives: QuestTemplate["objectives"];
  onboarding: boolean;
}

interface InstanceRow {
  id: string;
  template_id: string;
  template_version: number;
  scope_hash: string;
  title: string;
  description: string;
  recommended_level: number;
  objectives: QuestObjective[];
  status: "active" | "completed";
  started_at: Date;
  completed_at: Date | null;
  fresh_progress: boolean;
}

interface TimedCollectibleHistory {
  sourceId: string;
  category?: CollectibleCategory;
  timestampMs: number;
}

interface TimedFlowlineHistory {
  flowlineId: string;
  activityId: string;
  lengthMeters: number;
  averageSpeedMps: number;
  timestampMs: number;
}

export const historyFromQuestStart = (
  history: { collectibles: TimedCollectibleHistory[]; flowlines: TimedFlowlineHistory[] },
  startedAtMs: number
): QuestHistory => {
  return {
    collectibles: history.collectibles
      .filter((event) => event.timestampMs >= startedAtMs)
      .map(({ sourceId, category }) => ({
        sourceId,
        ...(category === undefined ? {} : { category })
      })),
    flowlines: history.flowlines
      .filter((completion) => completion.timestampMs >= startedAtMs)
      .map(({ flowlineId, activityId, lengthMeters, averageSpeedMps, timestampMs }) => ({
        flowlineId,
        activityId,
        lengthMeters,
        averageSpeedMps,
        timestampMs
      }))
  };
};

const mapTemplate = (row: TemplateRow): QuestTemplate => ({
  id: row.id,
  version: row.version,
  title: row.title,
  description: row.description,
  recommendedLevel: row.recommended_level,
  objectives: row.objectives,
  ...(row.onboarding ? { onboarding: true } : {})
});

export class QuestTemplateUnavailableError extends Error {
  constructor() {
    super("This quest template is no longer available.");
  }
}

export class QuestInstanceNotFoundError extends Error {
  constructor() {
    super("Quest instance not found.");
  }
}

export class QuestInstanceStateError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class QuestInstanceRepository {
  constructor(private readonly pool: Pool) {}

  async listActiveTemplates(): Promise<QuestTemplate[]> {
    const result = await this.pool.query<TemplateRow>(
      `SELECT DISTINCT ON (id) id, version, title, description, recommended_level, objectives, onboarding
       FROM quest_templates
       WHERE active = true
       ORDER BY id, version DESC`
    );
    return result.rows.map(mapTemplate);
  }

  async replaceTemplates(templates: QuestTemplate[]): Promise<void> {
    for (const template of templates) validateQuestTemplate(template);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE quest_templates SET active = false, updated_at = now()");
      for (const template of templates) {
        await client.query(
          `INSERT INTO quest_templates (
            id, version, title, description, recommended_level, objectives, onboarding, active
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, true)
          ON CONFLICT (id, version) DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            recommended_level = EXCLUDED.recommended_level,
            objectives = EXCLUDED.objectives,
            onboarding = EXCLUDED.onboarding,
            active = true,
            updated_at = now()`,
          [
            template.id,
            template.version,
            template.title,
            template.description,
            template.recommendedLevel,
            JSON.stringify(template.objectives),
            template.onboarding ?? false
          ]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async start(playerId: string, suggestion: QuestSuggestion): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const template = await client.query(
        "SELECT 1 FROM quest_templates WHERE id = $1 AND version = $2 AND active = true",
        [suggestion.templateId, suggestion.templateVersion]
      );
      if (template.rowCount !== 1) throw new QuestTemplateUnavailableError();
      const cancellation = await client.query(
        `SELECT 1 FROM quest_instance_cancellations
         WHERE player_id = $1 AND template_id = $2 AND template_version = $3 AND scope_hash = $4`,
        [playerId, suggestion.templateId, suggestion.templateVersion, suggestion.id]
      );
      const id = randomUUID();
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO quest_instances (
          id, player_id, template_id, template_version, scope_hash,
          title, description, recommended_level, objectives, fresh_progress
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (player_id, template_id, template_version, scope_hash) DO NOTHING
        RETURNING id`,
        [
          id,
          playerId,
          suggestion.templateId,
          suggestion.templateVersion,
          suggestion.id,
          suggestion.title,
          suggestion.description,
          suggestion.recommendedLevel,
          JSON.stringify(suggestion.objectives),
          cancellation.rows.length > 0
        ]
      );
      if (inserted.rowCount === 1) {
        await client.query("COMMIT");
        return inserted.rows[0].id;
      }
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM quest_instances
         WHERE player_id = $1 AND template_id = $2 AND template_version = $3 AND scope_hash = $4`,
        [playerId, suggestion.templateId, suggestion.templateVersion, suggestion.id]
      );
      if (existing.rowCount !== 1) throw new Error("Unable to resolve an existing quest instance.");
      await client.query("COMMIT");
      return existing.rows[0].id;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async cancel(playerId: string, instanceId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const deleted = await client.query<{
        template_id: string;
        template_version: number;
        scope_hash: string;
      }>(
        `DELETE FROM quest_instances
         WHERE id = $1 AND player_id = $2 AND status = 'active'
         RETURNING template_id, template_version, scope_hash`,
        [instanceId, playerId]
      );
      if (deleted.rowCount !== 1) {
        const current = await client.query<{ status: "active" | "completed" }>(
          "SELECT status FROM quest_instances WHERE id = $1 AND player_id = $2",
          [instanceId, playerId]
        );
        if (current.rowCount !== 1) throw new QuestInstanceNotFoundError();
        throw new QuestInstanceStateError("Only active quests can be cancelled.");
      }

      const cancelled = deleted.rows[0];
      await client.query(
        `INSERT INTO quest_instance_cancellations (
          player_id, template_id, template_version, scope_hash, cancelled_at
        ) VALUES ($1, $2, $3, $4, now())
        ON CONFLICT (player_id, template_id, template_version, scope_hash)
        DO UPDATE SET cancelled_at = EXCLUDED.cancelled_at`,
        [playerId, cancelled.template_id, cancelled.template_version, cancelled.scope_hash]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listForPlayer(playerId: string): Promise<QuestInstance[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const instances = await client.query<InstanceRow>(
        `SELECT id, template_id, template_version, scope_hash, title, description, recommended_level,
                objectives, status, started_at, completed_at, fresh_progress
         FROM quest_instances WHERE player_id = $1
         ORDER BY started_at DESC, id`,
        [playerId]
      );
      if (instances.rowCount === 0) {
        await client.query("COMMIT");
        return [];
      }
      const collectibleTargetIds = new Set<string>();
      const flowlineTargetIds = new Set<string>();
      for (const instance of instances.rows) {
        for (const objective of instance.objectives) {
          const targetIds = objective.targets.map((target) => target.id);
          if (objective.type === "flowline_rule") {
            targetIds.forEach((id) => flowlineTargetIds.add(id));
          } else {
            targetIds.forEach((id) => collectibleTargetIds.add(id));
          }
        }
      }
      const [collectibleHistory, flowlineHistory] = await Promise.all([
        collectibleTargetIds.size === 0
          ? Promise.resolve({ rows: [] as Array<{
            source_id: string;
            collectible_category: CollectibleCategory | null;
            activity_timestamp: number | string;
          }> })
          : client.query<{
            source_id: string;
            collectible_category: CollectibleCategory | null;
            activity_timestamp: number | string;
          }>(
          `SELECT DISTINCT events.source_id, events.collectible_category, events.activity_timestamp
           FROM activity_events AS events
           INNER JOIN activities ON activities.id = events.activity_id
           WHERE activities.player_id = $1 AND events.source_id = ANY($2::text[])`,
          [playerId, [...collectibleTargetIds]]
        ),
        flowlineTargetIds.size === 0
          ? Promise.resolve({ rows: [] as Array<{
            fartlek_id: string;
            activity_id: string;
            fartlek_length_m_snapshot: number;
            average_speed_mps: number;
            completed_at: Date;
          }> })
          : client.query<{
          fartlek_id: string;
          activity_id: string;
          fartlek_length_m_snapshot: number;
          average_speed_mps: number;
          completed_at: Date;
        }>(
          `SELECT fartlek_id, activity_id, fartlek_length_m_snapshot, average_speed_mps, completed_at
           FROM fartlek_completions WHERE player_id = $1 AND fartlek_id = ANY($2::text[])`,
          [playerId, [...flowlineTargetIds]]
        )
      ]);
      const timedHistory = {
        collectibles: collectibleHistory.rows.map((row) => ({
          sourceId: row.source_id,
          ...(row.collectible_category === null ? {} : { category: row.collectible_category }),
          timestampMs: Number(row.activity_timestamp)
        })),
        flowlines: flowlineHistory.rows.map((row) => ({
          flowlineId: row.fartlek_id,
          activityId: row.activity_id,
          lengthMeters: row.fartlek_length_m_snapshot,
          averageSpeedMps: row.average_speed_mps,
          timestampMs: row.completed_at.getTime()
        }))
      };
      const mapped: QuestInstance[] = [];
      for (const row of instances.rows) {
        const history = row.fresh_progress
          ? historyFromQuestStart(timedHistory, row.started_at.getTime())
          : {
            collectibles: timedHistory.collectibles.map(({ sourceId, category }) => ({
              sourceId,
              ...(category === undefined ? {} : { category })
            })),
            flowlines: timedHistory.flowlines.map(({ flowlineId, activityId, lengthMeters, averageSpeedMps, timestampMs }) => ({
              flowlineId,
              activityId,
              lengthMeters,
              averageSpeedMps,
              timestampMs
            }))
          };
        const objectiveStates: QuestObjectiveState[] = evaluateQuestObjectives(row.objectives, history);
        const complete = objectiveStates.every((state) => state.progress.complete);
        let status = row.status;
        let completedAt = row.completed_at;
        if (complete && status !== "completed") {
          const updated = await client.query<{ completed_at: Date }>(
            `UPDATE quest_instances SET status = 'completed', completed_at = now()
             WHERE id = $1 AND player_id = $2 AND status = 'active'
             RETURNING completed_at`,
            [row.id, playerId]
          );
          if (updated.rowCount === 1) {
            status = "completed";
            completedAt = updated.rows[0].completed_at;
          } else {
            const stored = await client.query<{ status: "active" | "completed"; completed_at: Date | null }>(
              "SELECT status, completed_at FROM quest_instances WHERE id = $1 AND player_id = $2",
              [row.id, playerId]
            );
            status = stored.rows[0]?.status ?? status;
            completedAt = stored.rows[0]?.completed_at ?? completedAt;
          }
        }
        mapped.push({
          id: row.id,
          suggestionId: row.scope_hash,
          templateId: row.template_id,
          templateVersion: row.template_version,
          title: row.title,
          description: row.description,
          recommendedLevel: row.recommended_level,
          status,
          startedAt: row.started_at.toISOString(),
          ...(completedAt === null ? {} : { completedAt: completedAt.toISOString() }),
          objectives: objectiveStates
        });
      }
      await client.query("COMMIT");
      return mapped;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseObjectiveTemplate = (value: unknown, templateId: string): QuestObjectiveTemplate => {
  if (!isRecord(value) || typeof value.requiredCount !== "number"
    || !Number.isSafeInteger(value.requiredCount) || typeof value.type !== "string") {
    throw new Error(`Quest template ${templateId} has an invalid objective.`);
  }
  const requiredCount = value.requiredCount;
  if (value.type === "flowline_rule") {
    if ((value.minimumLengthMeters !== undefined && typeof value.minimumLengthMeters !== "number")
      || (value.minimumAverageSpeedMps !== undefined && typeof value.minimumAverageSpeedMps !== "number")
      || (value.sameActivity !== undefined && typeof value.sameActivity !== "boolean")) {
      throw new Error(`Quest template ${templateId} has invalid Flowline objective criteria.`);
    }
    return {
      type: value.type,
      requiredCount,
      ...(value.minimumLengthMeters === undefined ? {} : { minimumLengthMeters: value.minimumLengthMeters }),
      ...(value.minimumAverageSpeedMps === undefined ? {} : { minimumAverageSpeedMps: value.minimumAverageSpeedMps }),
      ...(value.sameActivity === undefined ? {} : { sameActivity: value.sameActivity })
    };
  }
  if (value.type === "collectible_count") {
    if (!isCollectibleCategory(value.category)) {
      throw new Error(`Quest template ${templateId} has an invalid collectible category.`);
    }
    return { type: value.type, requiredCount, category: value.category };
  }
  if (value.type === "collectible_targets") {
    if (value.category !== undefined && !isCollectibleCategory(value.category)) {
      throw new Error(`Quest template ${templateId} has an invalid collectible category.`);
    }
    return {
      type: value.type,
      requiredCount,
      ...(value.category === undefined ? {} : { category: value.category })
    };
  }
  throw new Error(`Quest template ${templateId} has an unsupported objective type.`);
};

const parseQuestTemplate = (value: unknown): QuestTemplate => {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.title !== "string"
    || typeof value.description !== "string" || typeof value.version !== "number"
    || typeof value.recommendedLevel !== "number" || !Array.isArray(value.objectives)
    || (value.onboarding !== undefined && typeof value.onboarding !== "boolean")) {
    throw new Error("Quest template has invalid top-level fields.");
  }
  const templateId = value.id;
  const template: QuestTemplate = {
    id: templateId,
    version: value.version,
    title: value.title,
    description: value.description,
    recommendedLevel: value.recommendedLevel,
    objectives: value.objectives.map((objective) => parseObjectiveTemplate(objective, templateId)),
    ...(value.onboarding === true ? { onboarding: true } : {})
  };
  validateQuestTemplate(template);
  return template;
};

export const readQuestTemplateRows = async (file: string): Promise<QuestTemplate[]> => {
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${file} must contain a quest-template array.`);
  const templates = parsed.map(parseQuestTemplate);
  const seen = new Set<string>();
  for (const template of templates) {
    const key = `${template.id}:${template.version}`;
    if (seen.has(key)) throw new Error(`Duplicate quest template ${key}.`);
    seen.add(key);
  }
  return templates;
};
