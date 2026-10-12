import { PLANNING_LIMITS } from "./policy.js";
import type { StoredProposal } from "./types.js";

/**
 * Ephemeral, server-side store of generated proposals. Clients confirm by proposal id only, so
 * route geometry and target claims can never be tampered with. Entries expire, are
 * scoped to the player that planned them and are lost on restart (players simply plan again).
 */
export class ProposalStore {
  private readonly entries = new Map<string, StoredProposal>();
  private readonly byPlayer = new Map<string, string[]>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = PLANNING_LIMITS.proposalTtlMs,
    private readonly maxEntries: number = PLANNING_LIMITS.maxStoredProposals,
    private readonly maxPerPlayer: number = PLANNING_LIMITS.maxStoredProposalsPerPlayer
  ) {}

  /** Replaces the player's previous proposals with a fresh set. */
  replaceForPlayer(playerId: string, proposals: Omit<StoredProposal, "playerId" | "expiresAtMs">[]): void {
    this.sweep();
    for (const id of this.byPlayer.get(playerId) ?? []) this.entries.delete(id);
    const expiresAtMs = this.now() + this.ttlMs;
    const ids: string[] = [];
    for (const proposal of proposals) {
      this.entries.set(proposal.proposal.id, { ...proposal, playerId, expiresAtMs });
      ids.push(proposal.proposal.id);
    }
    this.byPlayer.set(playerId, ids);
    this.enforceCapacity();
  }

  /**
   * Adds one proposal (a customized route) next to the player's existing ones, so other
   * proposals and the originals behind customizations stay confirmable. Beyond the per-player
   * cap the oldest customized proposals are dropped first.
   */
  addForPlayer(playerId: string, proposal: Omit<StoredProposal, "playerId" | "expiresAtMs">): void {
    this.sweep();
    const ids = [...(this.byPlayer.get(playerId) ?? []), proposal.proposal.id];
    this.entries.set(proposal.proposal.id, { ...proposal, playerId, expiresAtMs: this.now() + this.ttlMs });
    while (ids.length > this.maxPerPlayer) {
      const index = ids.findIndex((id) => this.entries.get(id)?.proposal.customized);
      const [evicted] = ids.splice(index >= 0 ? index : 0, 1);
      this.entries.delete(evicted);
    }
    this.byPlayer.set(playerId, ids);
    this.enforceCapacity();
  }

  get(playerId: string, proposalId: string): StoredProposal | undefined {
    const entry = this.entries.get(proposalId);
    if (!entry || entry.playerId !== playerId) return undefined;
    if (entry.expiresAtMs <= this.now()) {
      this.entries.delete(proposalId);
      return undefined;
    }
    return entry;
  }

  get size(): number {
    return this.entries.size;
  }

  private sweep(): void {
    const now = this.now();
    for (const [id, entry] of this.entries) {
      if (entry.expiresAtMs <= now) this.entries.delete(id);
    }
    for (const [playerId, ids] of this.byPlayer) {
      const live = ids.filter((id) => this.entries.has(id));
      if (live.length === 0) this.byPlayer.delete(playerId);
      else this.byPlayer.set(playerId, live);
    }
  }

  /** Map iteration order is insertion order, so the oldest entries are evicted first. */
  private enforceCapacity(): void {
    for (const id of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) break;
      this.entries.delete(id);
    }
  }
}
