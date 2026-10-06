import type { FartlekCandidate, FartlekDecision, ScoredFartlekCandidate } from "./fartlekModel.js";
import {
  FARTLEK_IDEAL_MAX_LENGTH_METERS,
  FARTLEK_IDEAL_MIN_LENGTH_METERS,
  FARTLEK_MAX_LENGTH_METERS,
  FARTLEK_MIN_LENGTH_METERS
} from "./fartlekModel.js";

const UNSUITABLE_HIGHWAY_CLASSES = new Set(["motorway", "motorway_link", "trunk", "trunk_link"]);
const SUITABLE_HIGHWAY_CLASSES = new Set([
  "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified", "residential", "cycleway"
]);

const hasHardRejectFlag = (candidate: FartlekCandidate): string | undefined => {
  for (const tags of candidate.tagsBySegment) {
    if (tags.bicycle === "no") return "bicycle=no on the candidate.";
    if (tags.access === "private" || tags.access === "no") return "Private/no access on the candidate.";
    if (tags.route === "ferry") return "Ferry section on the candidate.";
    if (tags.highway && UNSUITABLE_HIGHWAY_CLASSES.has(tags.highway)) {
      return `Unsuitable road class (${tags.highway}) for cycling.`;
    }
  }
  if (candidate.coordinates.length < 2) return "Malformed candidate geometry.";
  return undefined;
};

/** Percentage of the candidate with known surface/smoothness/bicycle-access/maxspeed metadata. */
const mappingCompleteness = (candidate: FartlekCandidate): number => {
  if (candidate.tagsBySegment.length === 0) return 0;
  const perSegment = candidate.tagsBySegment.map((tags) => {
    let known = 0;
    if (tags.surface) known += 1;
    if (tags.smoothness) known += 1;
    if (tags.bicycle || tags.access) known += 1;
    if (tags.maxspeed) known += 1;
    return known / 4;
  });
  const tagCompleteness = perSegment.reduce((sum, value) => sum + value, 0) / perSegment.length;
  const junctionControlKnown = 1; // junction/control counts are always derivable from candidate generation.
  return Math.round(((tagCompleteness * 3 + junctionControlKnown) / 4) * 100);
};

const lengthMeters = (candidate: FartlekCandidate): number => candidate.lengthMeters;

const lengthScore = (length: number): { points: number; reason: string } => {
  if (length >= FARTLEK_IDEAL_MIN_LENGTH_METERS && length <= FARTLEK_IDEAL_MAX_LENGTH_METERS) {
    return { points: 15, reason: "Length within the ideal 2-8 km range: +15" };
  }
  if (length >= FARTLEK_MIN_LENGTH_METERS && length <= FARTLEK_MAX_LENGTH_METERS) {
    return { points: 5, reason: "Length acceptable but outside the ideal range: +5" };
  }
  return { points: -20, reason: "Length outside the acceptable 1-15 km range: -20" };
};

const perKm = (count: number, length: number): number => count / Math.max(length / 1_000, 0.001);

export const scoreFartlekCandidate = (candidate: FartlekCandidate): ScoredFartlekCandidate => {
  const length = lengthMeters(candidate);
  const mappingConfidence = mappingCompleteness(candidate);
  const rejectionReason = hasHardRejectFlag(candidate) ?? (length < FARTLEK_MIN_LENGTH_METERS
    ? `Length ${Math.round(length)} m is below the ${FARTLEK_MIN_LENGTH_METERS} m minimum.`
    : undefined);
  if (rejectionReason) {
    return { candidate, suitabilityScore: 0, mappingConfidence, reasons: [rejectionReason], decision: "REJECT", rejectionReason };
  }

  const reasons: string[] = [];
  let score = 50;
  const add = (points: number, reason: string): void => {
    score += points;
    reasons.push(`${reason}: ${points >= 0 ? "+" : ""}${points}`);
  };

  const { points: lengthPoints, reason: lengthReason } = lengthScore(length);
  score += lengthPoints;
  reasons.push(lengthReason);

  const surfaceAsphaltFraction = candidate.tagsBySegment.filter((tags) => tags.surface === "asphalt").length /
    Math.max(candidate.tagsBySegment.length, 1);
  if (surfaceAsphaltFraction > 0) add(Math.round(15 * surfaceAsphaltFraction), "Continuous asphalt surface evidence");
  else reasons.push("No asphalt surface evidence recorded.");

  const goodSmoothnessFraction = candidate.tagsBySegment.filter((tags) =>
    tags.smoothness === "excellent" || tags.smoothness === "good").length / Math.max(candidate.tagsBySegment.length, 1);
  if (goodSmoothnessFraction > 0) add(Math.round(10 * goodSmoothnessFraction), "Good/excellent smoothness evidence");

  const bicycleAllowed = candidate.tagsBySegment.some((tags) =>
    tags.bicycle === "yes" || tags.bicycle === "designated" || tags.highway === "cycleway");
  if (bicycleAllowed) add(10, "Explicit bicycle access allowed");

  const appropriateRoadClass = candidate.tagsBySegment.every((tags) =>
    !tags.highway || SUITABLE_HIGHWAY_CLASSES.has(tags.highway));
  if (appropriateRoadClass) add(10, "Appropriate road class for cycling");
  else add(-15, "Road class not ideal for cycling");

  const junctionDensity = perKm(candidate.junctionCount, length);
  if (junctionDensity < 1) add(10, "Low junction density");
  else if (junctionDensity < 3) add(5, "Moderate junction density");
  else add(-10, "High junction density");

  const controlDensity = perKm(candidate.trafficControlCount, length);
  if (controlDensity < 1) add(10, "Low traffic-control density");
  else if (controlDensity < 3) add(5, "Moderate traffic-control density");
  else add(-10, "High traffic-control density");

  const priorityRoadEvidence = candidate.tagsBySegment.some((tags) =>
    tags.highway === "secondary" || tags.highway === "primary" || tags.priority_road !== undefined);
  if (priorityRoadEvidence) add(5, "Priority-road evidence");

  const names = new Set(candidate.tagsBySegment.map((tags) => tags.ref ?? tags.name).filter(Boolean));
  if (names.size === 1) add(5, "Consistent road identity/ref/name");

  if (candidate.mostlyNonUrban) add(10, "Mostly non-urban section");
  else add(-10, "Predominantly urban/pedestrian context");

  if (candidate.hasClearBoundaries) add(5, "Clear start/end boundaries");

  const unknownSurfaceFraction = candidate.tagsBySegment.filter((tags) => !tags.surface).length /
    Math.max(candidate.tagsBySegment.length, 1);
  if (unknownSurfaceFraction >= 0.5) add(-10, "Unknown/low-confidence surface for most of the candidate");

  score = Math.max(0, Math.min(100, score));

  const decision: FartlekDecision = score >= 80 && mappingConfidence >= 85
    ? "AUTO_PUBLISH"
    : score >= 55 || (mappingConfidence >= 50 && mappingConfidence <= 85)
      ? "REVIEW"
      : "IGNORE";

  if (decision === "REVIEW" && score >= 80 && mappingConfidence < 85) {
    reasons.push("High score but incomplete safety/access metadata: review only, never auto-published.");
  }

  return { candidate, suitabilityScore: score, mappingConfidence, reasons, decision };
};

export const classifyFartlekScore = (score: number, mappingConfidence: number): FartlekDecision =>
  score >= 80 && mappingConfidence >= 85 ? "AUTO_PUBLISH" : score >= 55 ? "REVIEW" : "IGNORE";
