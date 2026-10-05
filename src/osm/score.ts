import type { Decision } from "./model.js";
import type { OSMCandidate, ScoredCandidate } from "./model.js";

const meaningfulAccess = (candidate: OSMCandidate): boolean => {
  const { access, foot, highway } = candidate.tags;
  return ["yes", "permissive", "designated", "public"].includes(foot ?? "") ||
    ["yes", "permissive", "public"].includes(access ?? "") ||
    (["footway", "path", "steps", "pedestrian"].includes(highway ?? "") &&
      access !== "private" && access !== "no" && foot !== "private" && foot !== "no");
};

const accessConflict = (candidate: OSMCandidate): boolean =>
  ["private", "no"].includes(candidate.tags.access ?? "") ||
  ["private", "no"].includes(candidate.tags.foot ?? "");

const measurement = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value.trim().replace(/\s*(m|meter|metres)$/i, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const decisionFor = (
  score: number,
  candidate: OSMCandidate,
  exceptionalUnnamed: boolean,
  accessConflictFound: boolean
): Decision => {
  if (accessConflictFound) return "REJECT";
  if (!candidate.name && !candidate.wikidataLabel) return score < 50 ? "IGNORE" : "REVIEW";
  if (!candidate.name && !exceptionalUnnamed) return "IGNORE";
  if (score >= 75 && candidate.wikidataCompatible !== false) return "AUTO_PUBLISH";
  if (score >= 50 || candidate.wikidataCompatible === false) return "REVIEW";
  return "IGNORE";
};

export const scoreCandidate = (candidate: OSMCandidate): ScoredCandidate => {
  if (accessConflict(candidate)) {
    return {
      candidate,
      score: 0,
      reasons: ["Explicit private/no access on target."],
      decision: "REJECT",
      rejectionReason: "Explicit private/no access on target."
    };
  }
  let score = 10;
  const reasons = ["Explicit imported category tag: +10"];
  if (candidate.name) {
    score += 15;
    reasons.push("Meaningful OSM name: +15");
  } else {
    score -= 20;
    reasons.push("Missing OSM name: -20");
  }
  if (candidate.wikidataQid) {
    score += 15;
    reasons.push("Direct Wikidata Q-ID: +15");
  }
  if (candidate.wikipediaSitelinkMatched) {
    score += 20;
    reasons.push("Exact Wikidata Wikipedia sitelink: +20");
  }
  if (meaningfulAccess(candidate)) {
    score += 10;
    reasons.push("Explicit public/permissive access evidence: +10");
  }

  let categoryEvidence = 0;
  switch (candidate.primaryCategory) {
    case "viewpoint":
      if (candidate.tags.direction || candidate.tags["camera:direction"] ||
        candidate.tags.observation || candidate.tags["observation:"] ||
        Object.keys(candidate.tags).some((key) => key.startsWith("observation:"))) {
        categoryEvidence = 10;
        reasons.push("Observation/direction metadata: +10");
      }
      break;
    case "peak": {
      const prominence = measurement(candidate.tags["prominence:peak"] ?? candidate.tags.prominence);
      if (prominence !== undefined && prominence >= 300) {
        categoryEvidence += 20;
        reasons.push("Prominence >=300 m: +20");
      } else if (prominence !== undefined && prominence >= 100) {
        categoryEvidence += 12;
        reasons.push("Prominence 100-299 m: +12");
      } else if (candidate.elevationMeters !== undefined) {
        categoryEvidence += 5;
        reasons.push("Elevation only: +5");
      }
      if (candidate.tags.tourism === "viewpoint") {
        categoryEvidence += 5;
        reasons.push("Peak also tagged as viewpoint: +5");
      }
      break;
    }
    case "castle":
      if (candidate.tags.castle_type) {
        categoryEvidence += 10;
        reasons.push("Structured castle_type: +10");
      }
      if (candidate.tags.tourism === "attraction" || candidate.tags.heritage ||
        candidate.tags["heritage:operator"]) {
        categoryEvidence += 10;
        reasons.push("Structured heritage/attraction identity: +10");
      }
      break;
    case "waterfall": {
      const height = measurement(candidate.tags.height);
      if (height !== undefined && height >= 10) {
        categoryEvidence += 15;
        reasons.push("Waterfall height >=10 m: +15");
      } else if (height !== undefined) {
        categoryEvidence += 5;
        reasons.push("Known waterfall height <10 m: +5");
      }
      if (candidate.tags.website || candidate.tags["contact:website"] ||
        candidate.tags.ref || candidate.tags.heritage || candidate.tags["heritage:operator"]) {
        categoryEvidence += 10;
        reasons.push("Official website/structured identity: +10");
      }
      break;
    }
    case "place": {
      if (candidate.tags.place === "square" || candidate.tags.place === "quarter") {
        categoryEvidence += 10;
        reasons.push(`Explicit place=${candidate.tags.place} classification: +10`);
      }
      if (candidate.tags.heritage || candidate.tags["heritage:operator"] || candidate.tags.historic) {
        categoryEvidence += 10;
        reasons.push("Structured heritage/historic identity: +10");
      }
      if (candidate.tags.website || candidate.tags["contact:website"] ||
        candidate.tags.operator || candidate.tags.ref) {
        categoryEvidence += 5;
        reasons.push("Official website/operator reference: +5");
      }
      break;
    }
  }
  score += categoryEvidence;
  score = Math.max(0, Math.min(100, score));
  const exceptionalUnnamed = !candidate.name && Boolean(candidate.wikidataLabel && candidate.wikidataQid) &&
    candidate.wikidataCompatible !== false && categoryEvidence >= 10;
  if (!candidate.name && !exceptionalUnnamed) score = Math.min(score, 49);
  const decision = decisionFor(score, candidate, exceptionalUnnamed, false);
  if (candidate.wikidataCompatible === false) reasons.push("Wikidata type/coordinate conflict: review only.");
  if (!meaningfulAccess(candidate)) reasons.push("Public access is not explicitly evidenced.");
  return { candidate, score, reasons, decision };
};

export const classifyScore = (score: number): Decision =>
  score >= 75 ? "AUTO_PUBLISH" : score >= 50 ? "REVIEW" : "IGNORE";
