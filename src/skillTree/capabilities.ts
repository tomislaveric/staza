import { SKILL_TREE_NODES } from "./catalog.js";
import type { SkillTreeGrant } from "./types.js";

export interface PlayerCapabilities {
  /** `world_filter` and `segment_filter` grant values the World page must expose. */
  worldFilters: string[];
  titles: { id: string; label: string }[];
  badges: { id: string; label: string }[];
}

/** "Earns the Flow Master title" -> "Flow Master". */
const displayName = (label: string): string => label.replace(/^Earns the\s+/i, "").replace(/\s+(title|badge)$/i, "");

/** World filters whose granting Atlas node is still locked, so the UI can say what unlocks them. */
export const lockedWorldFilters = (
  unlockedNodeIds: ReadonlySet<string>
): { id: string; nodeId: string; nodeName: string }[] => SKILL_TREE_NODES
  .filter((node) => (node.grant.type === "world_filter" || node.grant.type === "segment_filter") && !unlockedNodeIds.has(node.id))
  .map((node) => ({ id: node.grant.value, nodeId: node.id, nodeName: node.name }));

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
