import { createHash } from "node:crypto";
import type {
  CollectibleCategory,
  QuestObjective,
  QuestObjectiveProgress,
  QuestObjectiveTemplate,
  QuestSuggestion,
  QuestTemplate,
  WorldCollectible,
  WorldFartlek
} from "./domain.js";

export interface QuestGenerationInput {
  templates: QuestTemplate[];
  collectibles: WorldCollectible[];
  flowlines: WorldFartlek[];
}

export interface QuestHistory {
  collectibles: Array<{ sourceId: string; category?: CollectibleCategory }>;
  flowlines: Array<{
    flowlineId: string;
    activityId: string;
    lengthMeters: number;
    averageSpeedMps: number;
  }>;
}

const MINIMUM_RULE_COLLECTIBLES = 3;
const MINIMUM_TARGET_COLLECTIBLES = 3;
const MINIMUM_FLOWLINES = 2;
const MIXED_MINIMUM_WORK = 4;
const MAX_LOCAL_QUEST_SUGGESTIONS = 10;
const COLLECTIBLE_CATEGORIES: CollectibleCategory[] = [
  "viewpoint", "peak", "castle", "waterfall", "place", "mountain_pass"
];
const COLLECTIBLE_CATEGORY_SET = new Set<string>(COLLECTIBLE_CATEGORIES);

const isPositiveInteger = (value: number): boolean => Number.isSafeInteger(value) && value > 0;
const isPositiveFinite = (value: number): boolean => Number.isFinite(value) && value > 0;
export const isCollectibleCategory = (value: unknown): value is CollectibleCategory =>
  typeof value === "string" && COLLECTIBLE_CATEGORY_SET.has(value);

const workRequired = (objective: QuestObjectiveTemplate): number => objective.requiredCount;

export const validateQuestTemplate = (template: QuestTemplate): void => {
  if (!template.id.trim() || !template.title.trim() || !template.description.trim()) {
    throw new Error("Quest templates require nonblank ids, titles, and descriptions.");
  }
  if (!isPositiveInteger(template.version) || !isPositiveInteger(template.recommendedLevel)) {
    throw new Error(`Quest template ${template.id} has an invalid version or recommended level.`);
  }
  if (!Array.isArray(template.objectives) || template.objectives.length === 0) {
    throw new Error(`Quest template ${template.id} must have at least one objective.`);
  }
  const totalWork = template.objectives.reduce((total, objective) => total + workRequired(objective), 0);
  const mixed = template.objectives.length > 1;
  if (mixed && totalWork < (template.onboarding ? 2 : MIXED_MINIMUM_WORK)) {
    throw new Error(`Mixed quest template ${template.id} does not require enough work.`);
  }

  for (const objective of template.objectives) {
    if (!isPositiveInteger(objective.requiredCount)) {
      throw new Error(`Quest template ${template.id} has an invalid objective count.`);
    }
    if (objective.type === "flowline_rule") {
      if (objective.requiredCount < MINIMUM_FLOWLINES && !(template.onboarding && objective.requiredCount === 1)) {
        throw new Error(`Flowline objectives in ${template.id} must require multiple completions.`);
      }
      if (objective.minimumLengthMeters !== undefined && !isPositiveFinite(objective.minimumLengthMeters)) {
        throw new Error(`Quest template ${template.id} has an invalid minimum Flowline length.`);
      }
      if (objective.minimumAverageSpeedMps !== undefined
        && (!Number.isFinite(objective.minimumAverageSpeedMps) || objective.minimumAverageSpeedMps <= 0)) {
        throw new Error(`Quest template ${template.id} has an invalid average-speed threshold.`);
      }
    } else if (objective.type === "collectible_count") {
      if (!isCollectibleCategory(objective.category)) {
        throw new Error(`Quest template ${template.id} has an invalid collectible category.`);
      }
      if (objective.requiredCount < MINIMUM_RULE_COLLECTIBLES
        && !(mixed && totalWork >= MIXED_MINIMUM_WORK && objective.requiredCount >= 2)) {
        throw new Error(`Collectible-count objectives in ${template.id} must require at least three discoveries.`);
      }
    } else if (objective.type === "collectible_targets") {
      if (objective.category !== undefined && !isCollectibleCategory(objective.category)) {
        throw new Error(`Quest template ${template.id} has an invalid collectible category.`);
      }
      if (objective.requiredCount < MINIMUM_TARGET_COLLECTIBLES
        && !(template.onboarding && objective.requiredCount === 1)) {
        throw new Error(`Target-based collectible objectives in ${template.id} need at least three targets.`);
      }
    } else {
      throw new Error(`Quest template ${template.id} has an unsupported objective type.`);
    }
  }

  if (template.onboarding) {
    const hasSingleTargetStarter = template.objectives.some(
      (objective) => objective.type === "collectible_targets" && objective.requiredCount === 1
    );
    const hasFlowline = template.objectives.some((objective) => objective.type === "flowline_rule");
    if (!mixed || !hasSingleTargetStarter || !hasFlowline) {
      throw new Error(`Onboarding template ${template.id} must combine a single collectible target with a Flowline objective.`);
    }
  }
};

const sortedUniqueById = <T extends { id: string }>(values: T[]): T[] =>
  [...new Map(values.map((item) => [item.id, item])).values()].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  );

const targetSnapshot = (id: string, name: string) => ({ id, name });

const categoryOf = (collectible: WorldCollectible): CollectibleCategory | undefined =>
  collectible.primaryCategory ?? (collectible.type === "mountain_pass" ? "mountain_pass" : undefined);

const resolveObjective = (
  templateId: string,
  index: number,
  definition: QuestObjectiveTemplate,
  collectibles: WorldCollectible[],
  flowlines: WorldFartlek[]
): QuestObjective | undefined => {
  const objectiveId = `${templateId}:objective:${index + 1}`;
  if (definition.type === "flowline_rule") {
    const candidates = sortedUniqueById(flowlines.filter((flowline) =>
      definition.minimumLengthMeters === undefined || flowline.lengthMeters >= definition.minimumLengthMeters
    )).slice(0, definition.requiredCount + 2);
    if (candidates.length < definition.requiredCount) return undefined;
    return {
      id: objectiveId,
      type: definition.type,
      requiredCount: definition.requiredCount,
      targets: candidates.map((flowline) => targetSnapshot(flowline.id, flowline.name)),
      ...(definition.minimumLengthMeters === undefined ? {} : { minimumLengthMeters: definition.minimumLengthMeters }),
      ...(definition.minimumAverageSpeedMps === undefined ? {} : { minimumAverageSpeedMps: definition.minimumAverageSpeedMps }),
      ...(definition.sameActivity === undefined ? {} : { sameActivity: definition.sameActivity })
    };
  }

  const candidates = sortedUniqueById(collectibles.filter((collectible) =>
    collectible.visibility !== "hidden"
      && (definition.category === undefined || categoryOf(collectible) === definition.category)
  ));
  if (candidates.length < definition.requiredCount) return undefined;
  if (definition.type === "collectible_targets") {
    const targets = candidates.slice(0, definition.requiredCount);
    return {
      id: objectiveId,
      type: definition.type,
      requiredCount: targets.length,
      targets: targets.map((collectible) => targetSnapshot(collectible.id, collectible.name)),
      ...(definition.category === undefined ? {} : { category: definition.category })
    };
  }
  return {
    id: objectiveId,
    type: definition.type,
    requiredCount: definition.requiredCount,
    targets: candidates.slice(0, definition.requiredCount + 2)
      .map((collectible) => targetSnapshot(collectible.id, collectible.name)),
    category: definition.category
  };
};

const suggestionIdentity = (template: QuestTemplate, objectives: QuestObjective[]): string => {
  const scope = JSON.stringify({
    templateId: template.id,
    templateVersion: template.version,
    objectives
  });
  return createHash("sha256").update(scope).digest("hex").slice(0, 32);
};

export const generateQuestSuggestions = ({
  templates,
  collectibles,
  flowlines
}: QuestGenerationInput): QuestSuggestion[] => {
  const suggestions: QuestSuggestion[] = [];
  for (const template of templates) {
    validateQuestTemplate(template);
    const objectives = template.objectives.map((objective, index) =>
      resolveObjective(template.id, index, objective, collectibles, flowlines)
    );
    if (objectives.some((objective) => objective === undefined)) continue;
    const resolved = objectives.filter((objective): objective is QuestObjective => objective !== undefined);
    if (resolved.length !== template.objectives.length) continue;
    suggestions.push({
      id: suggestionIdentity(template, resolved),
      templateId: template.id,
      templateVersion: template.version,
      title: template.title,
      description: template.description,
      recommendedLevel: template.recommendedLevel,
      objectives: resolved
    });
    if (suggestions.length === MAX_LOCAL_QUEST_SUGGESTIONS) break;
  }
  return suggestions;
};

export const evaluateQuestObjectives = (
  objectives: QuestObjective[],
  history: QuestHistory
): Array<{ objective: QuestObjective; progress: QuestObjectiveProgress }> => objectives.map((objective) => {
  let completed = 0;
  if (objective.type === "collectible_targets") {
    const discovered = new Set(history.collectibles.map((event) => event.sourceId));
    completed = objective.targets.filter((target) => discovered.has(target.id)).length;
  } else if (objective.type === "collectible_count") {
    const targetIds = new Set(objective.targets.map((target) => target.id));
    const discovered = new Set(history.collectibles
      .filter((event) => event.category === objective.category && targetIds.has(event.sourceId))
      .map((event) => event.sourceId));
    completed = discovered.size;
  } else {
    const targetIds = new Set(objective.targets.map((target) => target.id));
    const qualifying = history.flowlines.filter((completion) =>
      targetIds.has(completion.flowlineId)
        && (objective.minimumLengthMeters === undefined || completion.lengthMeters >= objective.minimumLengthMeters)
        && (objective.minimumAverageSpeedMps === undefined
          || completion.averageSpeedMps >= objective.minimumAverageSpeedMps)
    );
    if (objective.sameActivity) {
      const byActivity = new Map<string, Set<string>>();
      for (const completion of qualifying) {
        const ids = byActivity.get(completion.activityId) ?? new Set<string>();
        ids.add(completion.flowlineId);
        byActivity.set(completion.activityId, ids);
      }
      completed = Math.max(0, ...[...byActivity.values()].map((ids) => ids.size));
    } else {
      completed = new Set(qualifying.map((completion) => completion.flowlineId)).size;
    }
  }
  const boundedCompleted = Math.min(completed, objective.requiredCount);
  return {
    objective,
    progress: {
      completed: boundedCompleted,
      required: objective.requiredCount,
      complete: boundedCompleted >= objective.requiredCount
    }
  };
});
