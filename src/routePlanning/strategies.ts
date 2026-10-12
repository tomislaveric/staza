import type { QuestObjective } from "../domain.js";
import { budgetMeters } from "./candidates.js";
import { DEFAULT_PLANNER_POLICY, type PlannerPolicy } from "./policy.js";
import type { QuestRouteTarget, RideConstraint } from "./types.js";

/**
 * Internal target-selection strategies. Each is expressed as synthetic objectives (required
 * counts per target group) so the existing pool selection, candidate generation and scoring
 * are reused unchanged. Strategies are planning details and are never shown to players.
 */
export type StrategyName = "flowline_focus" | "balanced" | "discovery";

type TargetGroup = "flowline" | "peak" | "place" | "collectible";

export const STRATEGY_TUNING = {
  /** One target per this many kilometres of budget… */
  kmPerTarget: 12,
  /** …clamped to this range. */
  minTargets: 2,
  maxTargets: 8,
  /** Fallback order when a group has fewer targets than a strategy asks for. */
  redistributionOrder: ["collectible", "flowline", "place", "peak"] as TargetGroup[]
} as const;

export interface PlanningStrategy {
  name: StrategyName;
  objectives: QuestObjective[];
  /** Targets with objective ids assigned for this strategy. */
  targets: QuestRouteTarget[];
}

const groupsOf = (target: QuestRouteTarget): TargetGroup[] =>
  target.kind === "segment" ? ["flowline"]
    : target.category === "peak" ? ["peak", "collectible"]
      : target.category === "place" ? ["place", "collectible"]
        : ["collectible"];

/** Number of targets a strategy aims for, scaled to the ride budget. */
export const targetCountFor = (constraint: RideConstraint, policy: PlannerPolicy = DEFAULT_PLANNER_POLICY): number => {
  const { kmPerTarget, minTargets, maxTargets } = STRATEGY_TUNING;
  return Math.max(minTargets, Math.min(maxTargets, Math.round(budgetMeters(constraint, policy) / 1000 / kmPerTarget)));
};

const mixFor = (name: StrategyName, count: number): Record<TargetGroup, number> => {
  if (name === "flowline_focus") {
    const flowline = Math.ceil(count * 0.6);
    return { flowline, peak: 0, place: 0, collectible: count - flowline };
  }
  if (name === "discovery") {
    const flowline = count >= 4 ? 1 : 0;
    const peak = Math.round((count - flowline) / 3);
    const place = Math.round((count - flowline) / 3);
    return { flowline, peak, place, collectible: count - flowline - peak - place };
  }
  const flowline = Math.max(1, Math.round(count / 3));
  const peak = Math.floor((count - flowline) / 2);
  return { flowline, peak, place: count - flowline - peak, collectible: 0 };
};

/** Caps each group at its availability and moves the shortfall to groups with spare targets. */
const redistribute = (mix: Record<TargetGroup, number>, available: Record<TargetGroup, number>): Record<TargetGroup, number> => {
  const result = { ...mix };
  // Peaks and places also count as collectibles; the collectible group may only use the rest.
  const spare = (group: TargetGroup) => group === "collectible"
    ? available.collectible - result.peak - result.place - result.collectible
    : available[group] - result[group];
  let shortfall = 0;
  for (const group of ["flowline", "peak", "place"] as TargetGroup[]) {
    const excess = Math.max(0, result[group] - available[group]);
    result[group] -= excess;
    shortfall += excess;
  }
  const collectibleExcess = Math.max(0, -spare("collectible"));
  result.collectible -= collectibleExcess;
  shortfall += collectibleExcess;
  for (const group of STRATEGY_TUNING.redistributionOrder) {
    if (shortfall === 0) break;
    const add = Math.min(shortfall, Math.max(0, spare(group)));
    result[group] += add;
    shortfall -= add;
  }
  return result;
};

const objectiveFor = (group: TargetGroup, requiredCount: number, targets: QuestRouteTarget[]): QuestObjective => {
  const references = targets.filter((target) => groupsOf(target).includes(group)).map(({ id, name }) => ({ id, name }));
  if (group === "flowline") return { id: "flowline", type: "flowline_rule", requiredCount, targets: references };
  return {
    id: group,
    type: "collectible_targets",
    requiredCount,
    ...(group === "peak" || group === "place" ? { category: group } : {}),
    targets: references
  };
};

/** Builds the strategies that are viable for these targets; duplicates of the same mix are dropped. */
export const buildStrategies = (
  targets: QuestRouteTarget[],
  constraint: RideConstraint,
  policy: PlannerPolicy = DEFAULT_PLANNER_POLICY
): PlanningStrategy[] => {
  const available: Record<TargetGroup, number> = { flowline: 0, peak: 0, place: 0, collectible: 0 };
  for (const target of targets) for (const group of groupsOf(target)) available[group] += 1;
  const count = targetCountFor(constraint, policy);
  const seen = new Set<string>();
  const strategies: PlanningStrategy[] = [];
  for (const name of ["balanced", "flowline_focus", "discovery"] as StrategyName[]) {
    const mix = redistribute(mixFor(name, count), available);
    const key = JSON.stringify(mix);
    if (seen.has(key)) continue;
    seen.add(key);
    const objectives = (Object.keys(mix) as TargetGroup[])
      .filter((group) => mix[group] > 0)
      .map((group) => objectiveFor(group, mix[group], targets));
    if (objectives.length === 0) continue;
    const ids = new Set(objectives.map((objective) => objective.id));
    strategies.push({
      name,
      objectives,
      targets: targets.map((target) => ({ ...target, objectiveIds: groupsOf(target).filter((group) => ids.has(group)) }))
    });
  }
  return strategies;
};
