import type { CollectibleCategory, QuestObjective } from "../domain.js";
import type { QuestRouteTarget } from "../routePlanning/types.js";

const reference = (target: QuestRouteTarget) => ({ id: target.id, name: target.name });

/**
 * Objectives of an exploration: complete every selected target. Flowlines form one
 * `flowline_rule`; collectibles form one `collectible_targets` objective per category. Ids are
 * stable so the planner and persisted progress speak about the same objectives.
 */
export const explorationObjectives = (targets: QuestRouteTarget[]): QuestObjective[] => {
  const sorted = [...targets].sort((a, b) => a.id.localeCompare(b.id));
  const objectives: QuestObjective[] = [];
  const flowlines = sorted.filter((target) => target.kind === "segment");
  if (flowlines.length > 0) {
    objectives.push({ id: "flowlines", type: "flowline_rule", requiredCount: flowlines.length, targets: flowlines.map(reference) });
  }
  const byCategory = new Map<CollectibleCategory | "other", QuestRouteTarget[]>();
  for (const target of sorted) {
    if (target.kind !== "point") continue;
    const key = target.category ?? "other";
    byCategory.set(key, [...(byCategory.get(key) ?? []), target]);
  }
  for (const [category, points] of [...byCategory].sort(([a], [b]) => a.localeCompare(b))) {
    objectives.push({
      id: `collectibles-${category}`,
      type: "collectible_targets",
      requiredCount: points.length,
      ...(category === "other" ? {} : { category }),
      targets: points.map(reference)
    });
  }
  return objectives;
};

/** Copies targets with their objective ids assigned for planning. */
export const withObjectiveIds = (targets: QuestRouteTarget[], objectives: QuestObjective[]): QuestRouteTarget[] =>
  targets.map((target) => ({
    ...target,
    objectiveIds: objectives.filter((objective) => objective.targets.some((item) => item.id === target.id)).map((objective) => objective.id)
  }));

const plural = (count: number, singular: string, pluralForm: string) => `${count} ${count === 1 ? singular : pluralForm}`;

/** Human title and summary of an exploration, derived from its targets. */
export const describeExploration = (targets: QuestRouteTarget[]): { title: string; description: string } => {
  const names = targets.map((target) => target.name);
  const title = names.length <= 2
    ? `Exploration: ${names.join(" & ")}`
    : `Exploration: ${names.slice(0, 2).join(", ")} +${names.length - 2}`;
  const flowlines = targets.filter((target) => target.kind === "segment").length;
  const peaks = targets.filter((target) => target.kind === "point" && target.category === "peak").length;
  const places = targets.filter((target) => target.kind === "point" && target.category === "place").length;
  const other = targets.length - flowlines - peaks - places;
  const parts = [
    flowlines ? plural(flowlines, "Flowline", "Flowlines") : "",
    peaks ? plural(peaks, "Peak", "Peaks") : "",
    places ? plural(places, "Place", "Places") : "",
    other ? plural(other, "other target", "other targets") : ""
  ].filter(Boolean);
  return { title, description: `Visit ${parts.join(", ")}.` };
};
