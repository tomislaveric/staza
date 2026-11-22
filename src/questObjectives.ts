import type {
  CollectibleCategory,
  QuestDifficulty,
  QuestObjective,
  QuestObjectiveState,
  QuestObjectiveTargetProgress
} from "./domain.js";

/** Bonus XP per quest difficulty. Quests never grant Skill Points. */
export const QUEST_XP_BY_DIFFICULTY: Record<QuestDifficulty, number> = {
  easy: 100,
  medium: 250,
  hard: 500,
  prestige: 1000
};

/** Exploration difficulty grows with how many targets one activity must reach. */
export const explorationDifficulty = (objectives: QuestObjective[]): QuestDifficulty => {
  const required = objectives.reduce((sum, objective) => sum + objective.requiredCount, 0);
  if (required <= 2) return "easy";
  if (required <= 5) return "medium";
  return "hard";
};

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

/**
 * Accumulates objective progress across activities: a target stays complete once any activity
 * completed it. `previous` is the stored state (absent before the first contributing activity).
 */
export const mergeObjectiveStates = (
  previous: QuestObjectiveState[] | undefined,
  current: QuestObjectiveState[]
): QuestObjectiveState[] => current.map((state) => {
  const before = previous?.find((candidate) => candidate.objective.id === state.objective.id);
  if (!before) return state;
  const earlier = new Map(before.targetProgress.map((target) => [target.id, target]));
  const targetProgress = state.targetProgress.map((target) => {
    const old = earlier.get(target.id);
    return old?.complete && !target.complete ? { ...target, ...old, complete: true } : target;
  });
  const sameActivity = state.objective.type === "flowline_rule" && state.objective.sameActivity === true;
  const completed = Math.min(
    state.objective.requiredCount,
    Math.max(
      before.progress.completed,
      state.progress.completed,
      sameActivity ? 0 : targetProgress.filter((target) => target.complete).length
    )
  );
  return {
    objective: state.objective,
    targetProgress,
    progress: { completed, required: state.objective.requiredCount, complete: completed >= state.objective.requiredCount }
  };
});

/** Number of objective units completed, summed over objectives. */
export const completedObjectiveUnits = (states: QuestObjectiveState[]): number =>
  states.reduce((total, state) => total + state.progress.completed, 0);
