import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { StravaError } from "../strava/errors.js";
import type { StravaAuthorization, StravaTokenSet } from "../strava/client.js";
import type { TokenCipher } from "../strava/tokenCipher.js";

export const STRAVA_OAUTH_STATE_TTL_MS = 10 * 60_000;
/** Access tokens expiring within this margin are refreshed before a request. */
export const STRAVA_REFRESH_MARGIN_MS = 10 * 60_000;

export type StravaConnectionState = "disconnected" | "connected" | "reconnect_required";
export type StravaReturnLocale = "en" | "de";

/** Safe, credential-free connection status suitable for API responses. */
export interface StravaConnectionStatus {
  status: StravaConnectionState;
  connectedAt?: string;
}

interface ConnectionRow {
  status: "active" | "reconnect_required";
  access_token_ciphertext: string;
  refresh_token_ciphertext: string;
  access_token_expires_at: Date;
}

const stateHash = (value: string): string => createHash("sha256").update(value).digest("hex");
const accessData = (playerId: string): string => `strava:${playerId}:access`;
const refreshData = (playerId: string): string => `strava:${playerId}:refresh`;

export class StravaConnectionRepository {
  constructor(private readonly pool: Pool, private readonly cipher: TokenCipher) {}

  /** Creates a random, short-lived, single-use OAuth state bound to the player and session. */
  async createOAuthState(playerId: string, sessionId: string, locale: StravaReturnLocale): Promise<string> {
    const state = randomBytes(32).toString("base64url");
    await this.pool.query(
      "DELETE FROM strava_oauth_states WHERE player_id = $1 AND (expires_at <= now() OR used_at IS NOT NULL)",
      [playerId]
    );
    await this.pool.query(
      `INSERT INTO strava_oauth_states (id, state_hash, player_id, session_id, return_locale, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), stateHash(state), playerId, sessionId, locale, new Date(Date.now() + STRAVA_OAUTH_STATE_TTL_MS)]
    );
    return state;
  }

  /** Atomically consumes a state only for the same player and session that created it. */
  async consumeOAuthState(state: string, playerId: string, sessionId: string): Promise<{ locale: StravaReturnLocale } | undefined> {
    const result = await this.pool.query<{ return_locale: StravaReturnLocale }>(
      `UPDATE strava_oauth_states SET used_at = now()
       WHERE state_hash = $1 AND player_id = $2 AND session_id = $3 AND used_at IS NULL AND expires_at > now()
       RETURNING return_locale`,
      [stateHash(state), playerId, sessionId]
    );
    return result.rowCount === 1 ? { locale: result.rows[0].return_locale } : undefined;
  }

  async saveConnection(playerId: string, authorization: StravaAuthorization, scope: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO strava_connections (
         player_id, athlete_id, scope, status, access_token_ciphertext, refresh_token_ciphertext, access_token_expires_at
       ) VALUES ($1, $2, $3, 'active', $4, $5, $6)
       ON CONFLICT (player_id) DO UPDATE SET
         athlete_id = EXCLUDED.athlete_id, scope = EXCLUDED.scope, status = 'active',
         access_token_ciphertext = EXCLUDED.access_token_ciphertext,
         refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
         access_token_expires_at = EXCLUDED.access_token_expires_at, updated_at = now()`,
      [
        playerId,
        authorization.athleteId,
        scope,
        this.cipher.encrypt(authorization.accessToken, accessData(playerId)),
        this.cipher.encrypt(authorization.refreshToken, refreshData(playerId)),
        authorization.expiresAt
      ]
    );
  }

  async getStatus(playerId: string): Promise<StravaConnectionStatus> {
    const result = await this.pool.query<{ status: ConnectionRow["status"]; created_at: Date }>(
      "SELECT status, created_at FROM strava_connections WHERE player_id = $1",
      [playerId]
    );
    const row = result.rows[0];
    if (!row) return { status: "disconnected" };
    return {
      status: row.status === "active" ? "connected" : "reconnect_required",
      connectedAt: row.created_at.toISOString()
    };
  }

  /**
   * Returns a usable access token, refreshing it first when it is about to expire. The row lock
   * serializes concurrent refreshes so Strava's rotated refresh token is never lost.
   */
  async getAccessToken(playerId: string, refresh: (refreshToken: string) => Promise<StravaTokenSet>): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<ConnectionRow>(
        `SELECT status, access_token_ciphertext, refresh_token_ciphertext, access_token_expires_at
         FROM strava_connections WHERE player_id = $1 FOR UPDATE`,
        [playerId]
      );
      const row = result.rows[0];
      if (!row) throw new StravaError("not_connected");
      if (row.status !== "active") throw new StravaError("reconnect_required");
      if (row.access_token_expires_at.getTime() - Date.now() > STRAVA_REFRESH_MARGIN_MS) {
        await client.query("COMMIT");
        return this.cipher.decrypt(row.access_token_ciphertext, accessData(playerId));
      }
      let tokens: StravaTokenSet;
      try {
        tokens = await refresh(this.cipher.decrypt(row.refresh_token_ciphertext, refreshData(playerId)));
      } catch (error) {
        if (error instanceof StravaError && error.code === "reconnect_required") {
          await client.query(
            "UPDATE strava_connections SET status = 'reconnect_required', updated_at = now() WHERE player_id = $1",
            [playerId]
          );
          await client.query("COMMIT");
        } else {
          await client.query("ROLLBACK");
        }
        throw error;
      }
      await client.query(
        `UPDATE strava_connections SET access_token_ciphertext = $2, refresh_token_ciphertext = $3,
           access_token_expires_at = $4, updated_at = now() WHERE player_id = $1`,
        [
          playerId,
          this.cipher.encrypt(tokens.accessToken, accessData(playerId)),
          this.cipher.encrypt(tokens.refreshToken, refreshData(playerId)),
          tokens.expiresAt
        ]
      );
      await client.query("COMMIT");
      return tokens.accessToken;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async markReconnectRequired(playerId: string): Promise<void> {
    await this.pool.query(
      "UPDATE strava_connections SET status = 'reconnect_required', updated_at = now() WHERE player_id = $1",
      [playerId]
    );
  }

  /**
   * Removes the local connection, its encrypted tokens, and pending OAuth states. Returns the last
   * access token so the caller can attempt a remote revocation; nothing is retained for retry.
   */
  async deleteConnection(playerId: string): Promise<{ accessToken?: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const deleted = await client.query<{ access_token_ciphertext: string }>(
        "DELETE FROM strava_connections WHERE player_id = $1 RETURNING access_token_ciphertext",
        [playerId]
      );
      await client.query("DELETE FROM strava_oauth_states WHERE player_id = $1", [playerId]);
      await client.query("COMMIT");
      const ciphertext = deleted.rows[0]?.access_token_ciphertext;
      if (!ciphertext) return {};
      try {
        return { accessToken: this.cipher.decrypt(ciphertext, accessData(playerId)) };
      } catch {
        return {};
      }
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
