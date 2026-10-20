import type { Pool } from "pg";
import { findSkillTreeNode } from "../skillTree/catalog.js";
import { buildSkillTreeView, earnedPoints, unlockRejectionCode } from "../skillTree/eligibility.js";
import { aggregateSkillTreeStats } from "../skillTree/statsQuery.js";
import type { SkillTreeGrant, SkillTreeUnlockErrorCode, SkillTreeView } from "../skillTree/types.js";

export class SkillTreeUnlockError extends Error {
  constructor(public readonly code: SkillTreeUnlockErrorCode, message: string) {
    super(message);
    this.name = "SkillTreeUnlockError";
  }
}

export interface SkillTreeUnlockOutcome {
  created: boolean;
  view: SkillTreeView;
}

export class SkillTreeRepository {
  constructor(private readonly pool: Pool) {}

  async getView(playerId: string): Promise<SkillTreeView> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const stats = await aggregateSkillTreeStats(client, playerId);
      const premium = await client.query<{ is_premium: boolean }>(
        "SELECT is_premium FROM players WHERE id = $1",
        [playerId]
      );
      const unlocks = await client.query<{ node_id: string }>(
        "SELECT node_id FROM skill_tree_unlocks WHERE player_id = $1",
        [playerId]
      );
      await client.query("COMMIT");
      return buildSkillTreeView(
        stats,
        unlocks.rows.map((row) => row.node_id),
        premium.rows[0]?.is_premium ?? false
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Explicitly unlock a node. Idempotent: unlocking an already-unlocked node
   * returns `created: false` without charging again. All eligibility is
   * re-validated inside a single transaction with the player row locked, so the
   * balance can never be double-spent under concurrent requests.
   */
  async unlockNode(playerId: string, nodeId: string): Promise<SkillTreeUnlockOutcome> {
    const node = findSkillTreeNode(nodeId);
    if (!node) throw new SkillTreeUnlockError("unknown_node", `Unknown skill tree node: ${nodeId}`);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const player = await client.query<{ is_premium: boolean }>(
        "SELECT is_premium FROM players WHERE id = $1 FOR UPDATE",
        [playerId]
      );
      if (player.rowCount !== 1) throw new Error("Player does not exist.");
      const isPremium = player.rows[0].is_premium;

      const existingUnlocks = await client.query<{ node_id: string }>(
        "SELECT node_id FROM skill_tree_unlocks WHERE player_id = $1",
        [playerId]
      );
      const unlockedIds = new Set(existingUnlocks.rows.map((row) => row.node_id));

      const stats = await aggregateSkillTreeStats(client, playerId);

      if (unlockedIds.has(nodeId)) {
        await client.query("COMMIT");
        return { created: false, view: buildSkillTreeView(stats, unlockedIds, isPremium) };
      }

      const earned = earnedPoints(stats);
      const spent = [...unlockedIds].reduce((total, id) => total + (findSkillTreeNode(id)?.cost ?? 0), 0);
      const availableBalance = earned - spent;

      const rejection = unlockRejectionCode(node, stats, unlockedIds, isPremium, availableBalance);
      if (rejection) {
        await client.query("ROLLBACK");
        throw new SkillTreeUnlockError(rejection, `Cannot unlock ${nodeId}: ${rejection}`);
      }

      const inserted = await client.query(
        `INSERT INTO skill_tree_unlocks (player_id, node_id, cost)
         VALUES ($1, $2, $3)
         ON CONFLICT (player_id, node_id) DO NOTHING`,
        [playerId, nodeId, node.cost]
      );
      await client.query("COMMIT");

      const created = inserted.rowCount === 1;
      if (created) unlockedIds.add(nodeId);
      return { created, view: buildSkillTreeView(stats, unlockedIds, isPremium) };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async getUnlockedNodeIds(playerId: string): Promise<string[]> {
    const result = await this.pool.query<{ node_id: string }>(
      "SELECT node_id FROM skill_tree_unlocks WHERE player_id = $1 ORDER BY unlocked_at",
      [playerId]
    );
    return result.rows.map((row) => row.node_id);
  }

  /**
   * Bounded capability grants earned from unlocked nodes, for downstream
   * consumers (World filters, quest availability, Profile badges/titles). This
   * is the single read point so later features can consume grants without a
   * generic rules engine.
   */
  async getUnlockedCapabilities(playerId: string): Promise<SkillTreeGrant[]> {
    const unlockedIds = await this.getUnlockedNodeIds(playerId);
    return unlockedIds
      .map((id) => findSkillTreeNode(id)?.grant)
      .filter((grant): grant is SkillTreeGrant => grant !== undefined);
  }
}
