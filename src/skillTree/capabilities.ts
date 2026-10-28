import type { SkillTreeGrant } from "./types.js";

export interface PlayerCapabilities {
  /** `world_filter` and `segment_filter` grant values the World page must expose. */
  worldFilters: string[];
  titles: { id: string; label: string }[];
  badges: { id: string; label: string }[];
}

/** "Earns the Flow Master title" -> "Flow Master". */
const displayName = (label: string): string => label.replace(/^Earns the\s+/i, "").replace(/\s+(title|badge)$/i, "");

export const capabilitiesFromGrants = (grants: readonly SkillTreeGrant[]): PlayerCapabilities => {
  const pick = (type: SkillTreeGrant["type"]) => grants
    .filter((grant) => grant.type === type)
    .map((grant) => ({ id: grant.value, label: displayName(grant.label) }));
  return {
    worldFilters: grants
      .filter((grant) => grant.type === "world_filter" || grant.type === "segment_filter")
      .map((grant) => grant.value),
    titles: pick("title"),
    badges: pick("badge")
  };
};
