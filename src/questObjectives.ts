import type {
  CollectibleCategory,
  QuestObjective,
  QuestObjectiveState,
  QuestObjectiveTargetProgress
} from "./domain.js";

export interface QuestHistory {
  collectibles: Array<{ sourceId: string; category?: CollectibleCategory }>;
  flowlines: Array<{
    flowlineId: string;
    activityId: string;
    lengthMeters: number;
    averageSpeedMps: number;
    timestampMs?: number;
  }>;
}

/** Evaluates frozen quest/exploration objectives against a player's gameplay history. */
export const evaluateQuestObjectives = (
  objectives: QuestObjective[],
  history: QuestHistory
): QuestObjectiveState[] => objectives.map((objective) => {
  let completed = 0;
  const targetProgress: QuestObjectiveTargetProgress[] = objective.targets.map((target) => ({
    ...target,
    complete: false
  }));
  if (objective.type === "collectible_targets") {
    const discovered = new Set(history.collectibles.map((event) => event.sourceId));
    for (const target of targetProgress) target.complete = discovered.has(target.id);
    completed = targetProgress.filter((target) => target.complete).length;
  } else if (objective.type === "collectible_count") {
    const targetIds = new Set(objective.targets.map((target) => target.id));
    const discovered = new Set(history.collectibles
      .filter((event) => event.category === objective.category && targetIds.has(event.sourceId))
      .map((event) => event.sourceId));
    for (const target of targetProgress) target.complete = discovered.has(target.id);
    completed = targetProgress.filter((target) => target.complete).length;
  } else {
    const targetIds = new Set(objective.targets.map((target) => target.id));
    const qualifying = history.flowlines.filter((completion) =>
      targetIds.has(completion.flowlineId)
        && (objective.minimumLengthMeters === undefined || completion.lengthMeters >= objective.minimumLengthMeters)
        && (objective.minimumAverageSpeedMps === undefined
          || completion.averageSpeedMps >= objective.minimumAverageSpeedMps)
    );
    const qualifyingById = new Map<string, typeof qualifying[number]>();
    for (const completion of qualifying) {
      const previous = qualifyingById.get(completion.flowlineId);
      if (!previous || (completion.timestampMs ?? 0) >= (previous.timestampMs ?? 0)) {
        qualifyingById.set(completion.flowlineId, completion);
      }
    }
    for (const target of targetProgress) {
      const completion = qualifyingById.get(target.id);
      target.complete = completion !== undefined;
      if (completion) target.averageSpeedMps = completion.averageSpeedMps;
    }
    if (objective.sameActivity) {
      const byActivity = new Map<string, Set<string>>();
      for (const completion of qualifying) {
        const ids = byActivity.get(completion.activityId) ?? new Set<string>();
        ids.add(completion.flowlineId);
        byActivity.set(completion.activityId, ids);
      }
      completed = Math.max(0, ...[...byActivity.values()].map((ids) => ids.size));
    } else {
      completed = qualifyingById.size;
    }
  }
  const boundedCompleted = Math.min(completed, objective.requiredCount);
  return {
    objective,
    targetProgress,
    progress: {
      completed: boundedCompleted,
      required: objective.requiredCount,
      complete: boundedCompleted >= objective.requiredCount
    }
  };
});
