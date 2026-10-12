import { randomUUID } from "node:crypto";
import type { ExplorationSession } from "./types.js";

export const SESSION_LIMITS = {
  /** Idle lifetime; every read extends it. */
  ttlMs: 60 * 60_000,
  /** Global cap across all players; the oldest sessions are evicted first. */
  maxSessions: 2_000
} as const;

export type NewExplorationSession = Omit<ExplorationSession, "id" | "expiresAtMs">;

/**
 * Ephemeral server-side exploration sessions, one per player. Nothing here is persisted: an
 * abandoned session simply expires, and a restart loses sessions (players generate again).
 */
export class ExplorationSessionStore {
  private readonly sessions = new Map<string, ExplorationSession>();
  private readonly byPlayer = new Map<string, string>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = SESSION_LIMITS.ttlMs,
    private readonly maxSessions: number = SESSION_LIMITS.maxSessions
  ) {}

  /** Creates a session, replacing the player's previous one. */
  create(session: NewExplorationSession): ExplorationSession {
    this.sweep();
    const previous = this.byPlayer.get(session.playerId);
    if (previous) this.sessions.delete(previous);
    const created: ExplorationSession = { ...session, id: randomUUID(), expiresAtMs: this.now() + this.ttlMs };
    this.sessions.set(created.id, created);
    this.byPlayer.set(session.playerId, created.id);
    for (const id of this.sessions.keys()) {
      if (this.sessions.size <= this.maxSessions) break;
      this.delete(id);
    }
    return created;
  }

  get(playerId: string, sessionId: string): ExplorationSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session || session.playerId !== playerId) return undefined;
    if (session.expiresAtMs <= this.now()) {
      this.delete(sessionId);
      return undefined;
    }
    session.expiresAtMs = this.now() + this.ttlMs;
    return session;
  }

  get size(): number {
    return this.sessions.size;
  }

  private delete(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    if (session && this.byPlayer.get(session.playerId) === sessionId) this.byPlayer.delete(session.playerId);
  }

  private sweep(): void {
    const now = this.now();
    for (const [id, session] of this.sessions) {
      if (session.expiresAtMs <= now) this.delete(id);
    }
  }
}
