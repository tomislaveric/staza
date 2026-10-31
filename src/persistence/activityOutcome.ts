import type { PoolClient } from "pg";
import type { ActivityOutcome, ActivityResult, QuestOutcome } from "../domain.js";
import { getLevelForXp, getTotalXpRequiredForLevel } from "../progression.js";
import { earnedSkillPointsForLevel } from "../skillTree/catalog.js";
import { buildSkillTreeView } from "../skillTree/eligibility.js";
import { aggregateSkillTreeStats } from "../skillTree/statsQuery.js";
import type { SkillTreeView } from "../skillTree/types.js";

/** Reads the player's current Skill Atlas state using the transaction's client. */
export const readSkillTreeView = async (client: PoolClient, playerId: string): Promise<SkillTreeView> => {
  const stats = await aggregateSkillTreeStats(client, playerId);
  const unlocks = await client.query<{ node_id: string }>(
    "SELECT node_id FROM skill_tree_unlocks WHERE player_id = $1",
    [playerId]
  );
  const player = await client.query<{ is_premium: boolean }>(
    "SELECT is_premium FROM players WHERE id = $1",
    [playerId]
  );
  return buildSkillTreeView(stats, unlocks.rows.map((row) => row.node_id), player.rows[0]?.is_premium ?? false);
};

export interface ActivityOutcomeInput {
  /** The result after collectible claims were resolved (revisits carry no XP). */
  result: ActivityResult;
  previousTotalXp: number;
  newTotalXp: number;
  newFlowlineCount: number;
  quests: QuestOutcome[];
  skillTreeBefore: SkillTreeView;
  skillTreeAfter: SkillTreeView;
}

/** Assembles the authoritative "what changed" for one imported activity. */
export const buildActivityOutcome = (input: ActivityOutcomeInput): ActivityOutcome => {
  const { result } = input;
  const flowlineXp = result.fartlekCompletions.reduce((total, completion) => total + (completion.xp ?? 0), 0);
  const collectibleXp = result.events.reduce((total, event) => total + (event.repeat ? 0 : event.value), 0);
  const questXp = input.quests.reduce((total, quest) => total + quest.xp, 0);
  const previousLevel = getLevelForXp(input.previousTotalXp);
  const newLevel = getLevelForXp(input.newTotalXp);
  const levels: ActivityOutcome["progression"]["levels"] = [];
  for (let level = previousLevel; level <= newLevel + 1; level += 1) {
    levels.push({
      level,
      totalXpRequired: getTotalXpRequiredForLevel(level),
      skillPointsAwarded: earnedSkillPointsForLevel(level) - earnedSkillPointsForLevel(level - 1)
    });
  }
  const unlockableBefore = new Set(
    input.skillTreeBefore.nodes.filter((node) => node.state === "unlockable").map((node) => node.id)
  );
  return {
    version: 1,
    xp: {
      base: result.baseXp ?? 0,
      collectibles: collectibleXp,
      flowlines: flowlineXp,
      distance: result.distanceXp,
      quests: questXp,
      total: input.newTotalXp - input.previousTotalXp
    },
    progression: {
      previousTotalXp: input.previousTotalXp,
      newTotalXp: input.newTotalXp,
      previousLevel,
      newLevel,
      levelsGained: newLevel - previousLevel,
      skillPointsEarned: earnedSkillPointsForLevel(newLevel) - earnedSkillPointsForLevel(previousLevel),
      unspentSkillPoints: input.skillTreeAfter.balance,
      levels
    },
    unlockableNodes: input.skillTreeAfter.nodes
      .filter((node) => node.state === "unlockable" && !unlockableBefore.has(node.id))
      .map((node) => ({ id: node.id, name: node.name, cost: node.cost })),
    collectibles: {
      newCount: result.events.filter((event) => !event.repeat).length,
      revisitCount: result.events.filter((event) => event.repeat).length
    },
    flowlines: { completedCount: result.fartlekCompletions.length, newCount: input.newFlowlineCount },
    quests: input.quests
  };
};
