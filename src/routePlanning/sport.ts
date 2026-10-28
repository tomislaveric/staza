import { UserInputError } from "../errors.js";
import type { PlannerPolicy } from "./policy.js";
import type { RoutingProfile, Sport } from "./types.js";

export const SPORTS: readonly Sport[] = ["cycling", "running", "hiking"];

/** Missing sport means cycling, the original ride-only behaviour. */
export const parseSport = (value: unknown): Sport => {
  if (value === undefined || value === null) return "cycling";
  if (typeof value === "string" && (SPORTS as readonly string[]).includes(value)) return value as Sport;
  throw new UserInputError("Sport must be cycling, running or hiking.");
};

/** Running and hiking are both routed on foot. */
export const profileForSport = (sport: Sport | undefined): RoutingProfile =>
  sport === "running" || sport === "hiking" ? "pedestrian" : "bicycle";

/** Typical moving speeds, used only for pre-routing estimates of time-constrained plans. */
const SPEED_MPS: Record<Sport, number> = { cycling: 5, running: 2.8, hiking: 1.4 };

export const policyForSport = (policy: PlannerPolicy, sport: Sport | undefined): PlannerPolicy =>
  sport ? { ...policy, heuristicSpeedMps: SPEED_MPS[sport] } : policy;
