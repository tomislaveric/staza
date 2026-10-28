import type { SkillTreeView } from "../skillTree/types.js";
import { authoredQuestChainsForNode } from "./catalog.js";

/** Lets the Atlas node detail show the quest chain a `quest_unlock` node opens. */
export const withQuestChains = (view: SkillTreeView): SkillTreeView => ({
  ...view,
  nodes: view.nodes.map((node) => {
    const chain = node.grant.type === "quest_unlock" ? authoredQuestChainsForNode(node.id)[0] : undefined;
    return chain
      ? {
        ...node,
        questChain: {
          title: chain.title,
          quests: chain.quests.map(({ title, description, xp }) => ({ title, description, xp }))
        }
      }
      : node;
  })
});
