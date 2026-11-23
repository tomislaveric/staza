const validScore = (score) => Number.isFinite(score) && score >= 0 && score <= 100;

/** Compatibility path for servers/caches predating the length-aware policy. */
export const classifyFlowline = ({ lengthMeters, flowScore, enduranceScore, exploreScore }) => {
  const validLength = Number.isFinite(lengthMeters) && lengthMeters > 0;
  const primary = validLength && lengthMeters < 5000 && validScore(flowScore) && flowScore > 82 ? "flow" :
    validLength && lengthMeters >= 5000 && validScore(enduranceScore) && enduranceScore >= 65 ? "endurance" :
      validScore(exploreScore) && exploreScore >= 65 ? "explore" : null;
  return { primary, tags: primary ? [primary] : [], policyVersion: 2 };
};

export const flowlineCharacter = (flowline) => {
  const character = flowline.character;
  if (character && (character.policyVersion === 2 || character.primary === null)) return character;
  return classifyFlowline(flowline);
};

export const characterScore = (flowline, tag) =>
  tag === "flow" ? flowline.flowScore :
    tag === "endurance" ? flowline.enduranceScore :
      tag === "explore" ? flowline.exploreScore : undefined;
