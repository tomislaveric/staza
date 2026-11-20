import type { CollectibleCategory, QuestObjective } from "../domain.js";
import type { QuestRouteTarget } from "../routePlanning/types.js";

const reference = (target: QuestRouteTarget) => ({ id: target.id, name: target.name });

/**
 * Objectives of an exploration: visit every selected destination, one `collectible_targets`
 * objective per category. Flowlines a route happens to ride are never objectives, so Flowline
 * gameplay is untouched. Ids are stable so the planner and persisted progress speak about the
 * same objectives.
 */
export const explorationObjectives = (targets: QuestRouteTarget[]): QuestObjective[] => {
  const sorted = [...targets].sort((a, b) => a.id.localeCompare(b.id));
  const objectives: QuestObjective[] = [];
  const byCategory = new Map<CollectibleCategory | "other", QuestRouteTarget[]>();
  for (const target of sorted) {
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

/** Objective of a route planned through a revealed Flowline: ride it once, in full, in the activity. */
export const flowlineObjective = (flowline: { id: string; name: string }): QuestObjective => ({
  id: `flowline-${flowline.id}`,
  type: "flowline_rule",
  requiredCount: 1,
  targets: [{ id: flowline.id, name: flowline.name }]
});

/** Copies targets with their objective ids assigned for planning. */
export const withObjectiveIds = (targets: QuestRouteTarget[], objectives: QuestObjective[]): QuestRouteTarget[] =>
  targets.map((target) => ({
    ...target,
    objectiveIds: objectives.filter((objective) => objective.targets.some((item) => item.id === target.id)).map((objective) => objective.id)
  }));

const plural = (count: number, singular: string, pluralForm: string) => `${count} ${count === 1 ? singular : pluralForm}`;

/** Human title and summary of an exploration, derived from its targets. */
export const describeExploration = (
  targets: QuestRouteTarget[],
  flowlines: { name: string }[] = []
): { title: string; description: string } => {
  if (flowlines.length > 0) {
    const extra = targets.length > 0 ? ` and visit ${plural(targets.length, "destination", "destinations")}` : "";
    if (flowlines.length === 1) {
      return { title: `Exploration: ${flowlines[0].name}`, description: `Ride the Flowline ${flowlines[0].name} in full${extra}.` };
    }
    const names = flowlines.map((flowline) => flowline.name);
    return {
      title: `Exploration: ${names[0]} +${names.length - 1}`,
      description: `Ride ${plural(flowlines.length, "Flowline", "Flowlines")} in full${extra}.`
    };
  }
  if (targets.length === 0) return { title: "Exploration: Area route", description: "A route through the explored area." };
  const names = targets.map((target) => target.name);
  const title = names.length <= 2
    ? `Exploration: ${names.join(" & ")}`
    : `Exploration: ${names.slice(0, 2).join(", ")} +${names.length - 2}`;
  const peaks = targets.filter((target) => target.category === "peak").length;
  const places = targets.filter((target) => target.category === "place").length;
  const other = targets.length - peaks - places;
  const parts = [
    peaks ? plural(peaks, "Peak", "Peaks") : "",
    places ? plural(places, "Place", "Places") : "",
    other ? plural(other, "other target", "other targets") : ""
  ].filter(Boolean);
  return { title, description: `Visit ${parts.join(", ")}.` };
};
