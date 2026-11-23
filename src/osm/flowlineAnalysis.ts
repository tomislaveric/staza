import type { ScoredFartlekCandidate } from "./fartlekModel.js";
import { roadTrafficProfile } from "./roadSegment/traffic.js";
import { classifyFlowline, type FlowlineCharacterTag } from "../flowlineCharacter.js";

/** Historical classifier, retained only for offline label-transition analysis. */
export const legacyFlowlineCharacter = (scored: ScoredFartlekCandidate): FlowlineCharacterTag => {
  const scores = scored.scores;
  const entries = [
    { tag: "flow" as const, score: scores?.flow ?? scored.suitabilityScore, threshold: 70 },
    { tag: "endurance" as const, score: scores?.endurance, threshold: 65 },
    { tag: "explore" as const, score: scores?.explore, threshold: 65 }
  ].filter((entry): entry is typeof entry & { score: number } => entry.score !== undefined)
    .sort((left, right) => right.score - left.score);
  return entries.find((entry) => entry.score >= entry.threshold)?.tag ?? entries[0]?.tag ?? "flow";
};

export const flowlineAnalysisProfile = (scored: ScoredFartlekCandidate) => {
  const profiles = scored.candidate.tagsBySegment.map(roadTrafficProfile);
  const motorRoads = profiles.filter((profile) => profile.highwayClass !== "cycleway");
  const knownSpeeds = motorRoads.flatMap(({ speed }) => speed.kind === "known" ? [speed.kmh] : []);
  const maximum = knownSpeeds.length ? Math.max(...knownSpeeds) : undefined;
  const speedBucket = !motorRoads.length ? "cycleway" :
    motorRoads.some(({ speed }) => speed.kind === "unlimited") || (maximum !== undefined && maximum >= 70) ? ">=70" :
      maximum !== undefined && maximum >= 60 ? "60-69" :
        maximum !== undefined && maximum > 50 ? "51-59" :
          motorRoads.some(({ speed }) => speed.kind === "unknown") ? "unknown" : "<=50";
  return {
    highwayClasses: [...new Set(profiles.map((profile) => profile.highwayClass ?? "unknown"))].sort(),
    speedBucket,
    comfortEvidence: motorRoads.length && motorRoads.every((profile) => profile.strongComfortEvidence) ? "all" :
      motorRoads.some((profile) => profile.strongComfortEvidence) ? "partial" : "none",
    published: scored.decision === "AUTO_PUBLISH" && Boolean(scored.candidate.name),
    character: classifyFlowline({
      lengthMeters: scored.candidate.lengthMeters,
      flowScore: scored.scores?.flow ?? scored.suitabilityScore,
      enduranceScore: scored.scores?.endurance,
      exploreScore: scored.scores?.explore
    })
  };
};

const identityHash = (identity: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < identity.length; index += 1) {
    hash = Math.imul(hash ^ identity.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
};

/** Select from the full population, not just the extract's first N roads. */
export const sampleFlowlineAnalysis = <T extends { scored: ScoredFartlekCandidate }>(
  rows: T[], perGroup: number
): T[] => {
  const groups = new Map<string, T[]>();
  const compare = (left: T, right: T): number =>
    identityHash(left.scored.candidate.id) - identityHash(right.scored.candidate.id) ||
    left.scored.candidate.id.localeCompare(right.scored.candidate.id);
  for (const row of rows) {
    if (row.scored.candidate.lengthMeters < 1_000) continue;
    const profile = flowlineAnalysisProfile(row.scored);
    const key = [profile.highwayClasses.join("+"), profile.speedBucket, profile.comfortEvidence,
      profile.published ? `published.${profile.character.primary ?? "plain"}` : row.scored.rejectionReason ?? row.scored.decision].join("|");
    const group = groups.get(key) ?? [];
    group.push(row);
    group.sort(compare);
    if (group.length > perGroup) group.pop();
    groups.set(key, group);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([, group]) => group);
};
