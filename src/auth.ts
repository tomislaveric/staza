import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { createTransport, type Transporter } from "nodemailer";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type AuthenticatorTransportFuture
} from "@simplewebauthn/server";
import type { Pool } from "pg";

export interface AuthConfig {
  rpId?: string;
  rpName?: string;
  origin?: string;
  production: boolean;
}

export interface SessionUser {
  id: string;
  email: string;
  emailVerified: boolean;
  playerId: string;
  sessionId: string;
  csrfToken: string;
  stepUpAt?: Date;
}

interface PasskeyRow {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: Buffer;
  counter: number;
  transports: string[] | null;
}

const codeHash = (value: string): string => createHash("sha256").update(value).digest("hex");
const canonicalEmail = (value: unknown): string => {
  if (typeof value !== "string") throw new Error("A valid email address is required.");
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("A valid email address is required.");
  return email;
};
const token = (): string => randomBytes(32).toString("base64url");
const opaqueTokenHash = (value: string): string => codeHash(value);

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
}

export class EmailSender {
  private readonly transport?: Transporter;
  private readonly from?: string;

  constructor(private readonly production: boolean, smtp?: SmtpConfig) {
    if (smtp) {
      this.transport = createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: { user: smtp.user, pass: smtp.password }
      });
      this.from = smtp.from;
    }
  }

  async sendAuthenticationCode(email: string, code: string): Promise<void> {
    if (this.transport && this.from) {
      await this.transport.sendMail({
        from: this.from,
        to: email,
        subject: "Your Staza sign-in code",
        text: `Your Staza verification code is ${code}.\n\nIt expires in 10 minutes. If you did not request this code, you can ignore this email.`
      });
      return;
    }
    if (this.production) throw new Error("No production EmailSender has been configured.");
    console.info(`Development authentication code issued for ${email}: ${code}`);
  }

  async sendSecurityNotification(email: string, message: string): Promise<void> {
    if (this.transport && this.from) {
      await this.transport.sendMail({
        from: this.from,
        to: email,
        subject: "Staza security notification",
        text: message
      });
      return;
    }
    if (this.production) throw new Error("No production EmailSender has been configured.");
    console.info(`Development security notification for ${email}: ${message}`);
  }
}

export class AuthService {
  constructor(
    private readonly pool: Pool,
    private readonly settings: AuthConfig,
    private readonly emailSender: EmailSender
  ) {}

  async requestEmailCode(rawEmail: unknown, purpose: "register" | "login" | "step_up"): Promise<void> {
    const email = canonicalEmail(rawEmail);
    await this.limit(`email:${purpose}:${email}`, 5, 10 * 60_000);
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.pool.query(
      `UPDATE email_codes SET used_at = now()
       WHERE email = $1 AND purpose = $2 AND used_at IS NULL`,
      [email, purpose]
    );
    await this.pool.query(
      `INSERT INTO email_codes (id, email, purpose, code_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '10 minutes')`,
      [randomUUID(), email, purpose, codeHash(code)]
    );
    await this.emailSender.sendAuthenticationCode(email, code);
  }

  async register(rawEmail: unknown, code: unknown): Promise<{ sessionToken: string; user: SessionUser }> {
    const email = canonicalEmail(rawEmail);
    await this.verifyEmailCode(email, code, "register");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      let user = await client.query<{ id: string; email: string }>(
        "SELECT id, email FROM users WHERE email = $1 FOR UPDATE", [email]
      );
      if (user.rowCount === 0) {
        const userId = randomUUID();
        await client.query(
          "INSERT INTO users (id, email, email_verified_at) VALUES ($1, $2, now())",
          [userId, email]
        );
        await client.query(
          "INSERT INTO players (id, display_name, user_id) VALUES ($1, $2, $3)",
          [randomUUID(), email.split("@")[0], userId]
        );
        user = await client.query<{ id: string; email: string }>("SELECT id, email FROM users WHERE id = $1", [userId]);
      } else {
        await client.query("UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1", [user.rows[0].id]);
        await client.query(
          `INSERT INTO players (id, display_name, user_id)
           SELECT $1, $2, $3
           WHERE NOT EXISTS (SELECT 1 FROM players WHERE user_id = $3)`,
          [randomUUID(), email.split("@")[0], user.rows[0].id]
        );
      }
      const session = await this.createSessionWithClient(client, user.rows[0].id);
      const sessionUser = await this.sessionUserWithClient(client, session.tokenHash);
      await this.eventWithClient(client, user.rows[0].id, "registration", true);
      await client.query("COMMIT");
      if (!sessionUser) throw new Error("A player could not be created for the new account.");
      return { sessionToken: session.token, user: sessionUser };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async emailLogin(rawEmail: unknown, code: unknown): Promise<{ sessionToken?: string; user?: SessionUser }> {
    const email = canonicalEmail(rawEmail);
    await this.verifyEmailCode(email, code, "login");
    const user = await this.pool.query<{ id: string }>(
      "SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL", [email]
    );
    if (user.rowCount !== 1) return {};
    await this.ensurePlayer(user.rows[0].id);
    const session = await this.createSession(user.rows[0].id);
    await this.event(user.rows[0].id, "email_login", true);
    const sessionUser = await this.getSessionUser(session.token);
    if (!sessionUser) throw new Error("A player could not be created for the account.");
    return { sessionToken: session.token, user: sessionUser };
  }

  async getSessionUser(rawToken: string | undefined): Promise<SessionUser | undefined> {
    if (!rawToken) return undefined;
    const hash = opaqueTokenHash(rawToken);
    const user = await this.sessionUser(hash);
    if (!user) return undefined;
    await this.pool.query(
      `UPDATE sessions SET last_seen_at = now()
       WHERE token_hash = $1 AND last_seen_at < now() - interval '15 minutes'`,
      [hash]
    );
    return user;
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (rawToken) await this.pool.query("UPDATE sessions SET revoked_at = now() WHERE token_hash = $1", [opaqueTokenHash(rawToken)]);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.pool.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
    await this.event(userId, "logout_all", true);
  }

  async registrationOptions(user: SessionUser): Promise<unknown> {
    const config = this.webauthnConfig();
    const passkeys = await this.passkeys(user.id);
    const options = await generateRegistrationOptions({
      rpID: config.rpId,
      rpName: config.rpName,
      userID: Buffer.from(user.id),
      userName: user.email,
      userDisplayName: user.email,
      excludeCredentials: passkeys.map((passkey) => ({ id: passkey.credential_id, transports: this.transports(passkey.transports) })),
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" }
    });
    await this.storeChallenge(user.id, "passkey_registration", options.challenge);
    return options;
  }

  async verifyRegistration(user: SessionUser, response: RegistrationResponseJSON, name?: unknown): Promise<void> {
    const challenge = await this.consumeChallenge(user.id, "passkey_registration");
    const config = this.webauthnConfig();
    const verification = await verifyRegistrationResponse({
      response, expectedChallenge: challenge, expectedOrigin: config.origin, expectedRPID: config.rpId, requireUserVerification: true
    });
    if (!verification.verified || !verification.registrationInfo) throw new Error("Passkey registration could not be verified.");
    const credential = verification.registrationInfo.credential;
    await this.pool.query(
      `INSERT INTO passkeys (id, user_id, credential_id, public_key, counter, transports, device_type, backed_up, name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [randomUUID(), user.id, credential.id, Buffer.from(credential.publicKey), credential.counter,
        JSON.stringify(response.response.transports ?? []), verification.registrationInfo.credentialDeviceType,
        verification.registrationInfo.credentialBackedUp, typeof name === "string" && name.trim() ? name.trim().slice(0, 100) : "Passkey"]
    );
    await this.event(user.id, "passkey_registered", true);
  }

  async loginOptions(): Promise<unknown> {
    const config = this.webauthnConfig();
    const options = await generateAuthenticationOptions({ rpID: config.rpId, userVerification: "required" });
    await this.storeChallenge(undefined, "passkey_login", options.challenge);
    return options;
  }

  async verifyLogin(response: AuthenticationResponseJSON): Promise<{ sessionToken: string; user: SessionUser }> {
    const credentialId = response.id;
    const passkey = await this.pool.query<PasskeyRow>("SELECT * FROM passkeys WHERE credential_id = $1", [credentialId]);
    if (passkey.rowCount !== 1) throw new Error("Passkey login could not be verified.");
    const challenge = await this.consumeChallenge(undefined, "passkey_login");
    const config = this.webauthnConfig();
    const credential = passkey.rows[0];
    const verification = await verifyAuthenticationResponse({
      response, expectedChallenge: challenge, expectedOrigin: config.origin, expectedRPID: config.rpId,
      credential: { id: credential.credential_id, publicKey: new Uint8Array(credential.public_key), counter: credential.counter, transports: this.transports(credential.transports) },
      requireUserVerification: true
    });
    if (!verification.verified) throw new Error("Passkey login could not be verified.");
    await this.pool.query(
      "UPDATE passkeys SET counter = $2, last_used_at = now() WHERE id = $1",
      [credential.id, verification.authenticationInfo.newCounter]
    );
    await this.ensurePlayer(credential.user_id);
    const session = await this.createSession(credential.user_id, true);
    await this.event(credential.user_id, "passkey_login", true);
    const sessionUser = await this.getSessionUser(session.token);
    if (!sessionUser) throw new Error("A player could not be created for the account.");
    return { sessionToken: session.token, user: sessionUser };
  }

  async listPasskeys(userId: string): Promise<Array<{ id: string; name: string; createdAt: string; lastUsedAt?: string }>> {
    const result = await this.pool.query<{ id: string; name: string; created_at: Date; last_used_at: Date | null }>(
      "SELECT id, name, created_at, last_used_at FROM passkeys WHERE user_id = $1 ORDER BY created_at", [userId]
    );
    return result.rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at.toISOString(), ...(row.last_used_at ? { lastUsedAt: row.last_used_at.toISOString() } : {}) }));
  }

  async deletePasskey(user: SessionUser, id: string): Promise<void> {
    const count = await this.pool.query<{ count: string }>("SELECT count(*) FROM passkeys WHERE user_id = $1", [user.id]);
    if (Number(count.rows[0].count) <= 1 && !this.isFreshStepUp(user)) throw new Error("Recent step-up authentication is required to remove your last passkey.");
    const deleted = await this.pool.query("DELETE FROM passkeys WHERE id = $1 AND user_id = $2", [id, user.id]);
    if (deleted.rowCount !== 1) throw new Error("Passkey not found.");
    await this.event(user.id, "passkey_removed", true);
  }

  isFreshStepUp(user: SessionUser): boolean {
    return Boolean(user.stepUpAt && Date.now() - user.stepUpAt.getTime() < 10 * 60_000);
  }

  async markStepUp(userId: string, rawToken: string): Promise<void> {
    await this.pool.query("UPDATE sessions SET step_up_at = now() WHERE user_id = $1 AND token_hash = $2", [userId, opaqueTokenHash(rawToken)]);
  }

  async verifyStepUp(user: SessionUser, rawToken: string, code: unknown): Promise<void> {
    await this.verifyEmailCode(user.email, code, "step_up");
    await this.markStepUp(user.id, rawToken);
    await this.event(user.id, "step_up", true);
  }

  async exportAccount(user: SessionUser): Promise<unknown> {
    const [player, activities, events] = await Promise.all([
      this.pool.query("SELECT id, display_name, total_xp, journey_started_at, created_at FROM players WHERE id = $1", [user.playerId]),
      this.pool.query(
        `SELECT id, source_type, started_at, distance_meters, duration_seconds, xp_earned, collected_count, has_video, created_at
         FROM activities WHERE player_id = $1 ORDER BY created_at`, [user.playerId]
      ),
      this.pool.query(
        `SELECT events.id, events.activity_id, events.source_id, events.event_type, events.activity_timestamp, events.value,
                events.latitude, events.longitude, events.collectible_name, events.collectible_rarity, events.collectible_type
         FROM activity_events AS events INNER JOIN activities ON activities.id = events.activity_id
         WHERE activities.player_id = $1 ORDER BY events.activity_timestamp, events.id`, [user.playerId]
      )
    ]);
    return {
      exportedAt: new Date().toISOString(),
      account: { email: user.email },
      player: player.rows[0],
      activities: activities.rows,
      events: events.rows
    };
  }

  async createDeletionIntent(user: SessionUser): Promise<{ confirmationToken: string; expiresAt: string }> {
    if (!this.isFreshStepUp(user)) throw new Error("Recent step-up authentication is required.");
    const confirmationToken = token();
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    await this.pool.query(
      `INSERT INTO deletion_intents (id, user_id, confirmation_token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), user.id, opaqueTokenHash(confirmationToken), expiresAt]
    );
    return { confirmationToken, expiresAt: expiresAt.toISOString() };
  }

  async confirmDeletion(user: SessionUser, confirmationToken: unknown): Promise<string[]> {
    if (!this.isFreshStepUp(user) || typeof confirmationToken !== "string") {
      throw new Error("Recent step-up authentication and a deletion confirmation are required.");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const intent = await client.query<{ id: string }>(
        `SELECT id FROM deletion_intents WHERE user_id = $1 AND confirmation_token_hash = $2
         AND completed_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [user.id, opaqueTokenHash(confirmationToken)]
      );
      if (intent.rowCount !== 1) throw new Error("The deletion confirmation is invalid or expired.");
      const paths = await client.query<{ source_path: string; output_path: string | null }>(
        `SELECT video.source_path, video.output_path FROM activity_videos AS video
         INNER JOIN activities ON activities.id = video.activity_id WHERE activities.player_id = $1`,
        [user.playerId]
      );
      const mediaPaths = paths.rows.flatMap((row) => [row.source_path, ...(row.output_path ? [row.output_path] : [])]);
      for (const path of mediaPaths) {
        await client.query(
          "INSERT INTO media_cleanup_tasks (id, path) VALUES ($1, $2) ON CONFLICT (path) DO NOTHING",
          [randomUUID(), path]
        );
      }
      await client.query("UPDATE deletion_intents SET completed_at = now() WHERE id = $1", [intent.rows[0].id]);
      await client.query("DELETE FROM players WHERE user_id = $1", [user.id]);
      await client.query("DELETE FROM users WHERE id = $1", [user.id]);
      await client.query("COMMIT");
      return mediaPaths;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private webauthnConfig(): Required<Pick<AuthConfig, "rpId" | "rpName" | "origin">> {
    if (this.settings.rpId && this.settings.rpName && this.settings.origin) return this.settings as Required<Pick<AuthConfig, "rpId" | "rpName" | "origin">>;
    if (this.settings.production) throw new Error("WebAuthn is not configured.");
    return { rpId: "localhost", rpName: "Staza development", origin: "http://localhost:3000" };
  }

  private async verifyEmailCode(email: string, value: unknown, purpose: "register" | "login" | "step_up"): Promise<void> {
    if (typeof value !== "string" || !/^\d{6}$/.test(value)) throw new Error("The code is invalid or expired.");
    const result = await this.pool.query<{ id: string; code_hash: string; attempts: number }>(
      `SELECT id, code_hash, attempts FROM email_codes
       WHERE email = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [email, purpose]
    );
    const record = result.rows[0];
    if (!record || record.attempts >= 5) throw new Error("The code is invalid or expired.");
    const expected = Buffer.from(record.code_hash, "hex");
    const supplied = Buffer.from(codeHash(value), "hex");
    if (!timingSafeEqual(expected, supplied)) {
      await this.pool.query("UPDATE email_codes SET attempts = attempts + 1 WHERE id = $1", [record.id]);
      throw new Error("The code is invalid or expired.");
    }
    const consumed = await this.pool.query(
      "UPDATE email_codes SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id",
      [record.id]
    );
    if (consumed.rowCount !== 1) throw new Error("The code is invalid or expired.");
  }

  private async createSession(userId: string, steppedUp = false): Promise<{ token: string; tokenHash: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await this.createSessionWithClient(client, userId, steppedUp);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async ensurePlayer(userId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO players (id, display_name, user_id)
       SELECT $1, split_part(email, '@', 1), id
       FROM users
       WHERE id = $2
       ON CONFLICT (user_id) WHERE user_id IS NOT NULL DO NOTHING`,
      [randomUUID(), userId]
    );
  }

  private async createSessionWithClient(client: import("pg").PoolClient, userId: string, steppedUp = false): Promise<{ token: string; tokenHash: string }> {
    await client.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
    const value = token();
    const hash = opaqueTokenHash(value);
    await client.query(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at, absolute_expires_at, step_up_at)
       VALUES ($1, $2, $3, $4, now() + interval '7 days', now() + interval '30 days', $5)`,
      [randomUUID(), userId, hash, token(), steppedUp ? new Date() : null]
    );
    return { token: value, tokenHash: hash };
  }

  private async sessionUser(tokenHash: string): Promise<SessionUser | undefined> {
    const client = await this.pool.connect();
    try { return await this.sessionUserWithClient(client, tokenHash); } finally { client.release(); }
  }

  private async sessionUserWithClient(client: import("pg").PoolClient, tokenHash: string): Promise<SessionUser | undefined> {
    const result = await client.query<{ id: string; email: string; email_verified_at: Date | null; player_id: string; session_id: string; csrf_token: string; step_up_at: Date | null }>(
      `SELECT users.id, users.email, users.email_verified_at, players.id AS player_id, sessions.id AS session_id,
              sessions.csrf_token, sessions.step_up_at
       FROM sessions INNER JOIN users ON users.id = sessions.user_id
       INNER JOIN players ON players.user_id = users.id
       WHERE sessions.token_hash = $1 AND sessions.revoked_at IS NULL AND users.deleted_at IS NULL
         AND sessions.expires_at > now() AND sessions.absolute_expires_at > now()`,
      [tokenHash]
    );
    const row = result.rows[0];
    return row ? {
      id: row.id,
      email: row.email,
      emailVerified: row.email_verified_at !== null,
      playerId: row.player_id,
      sessionId: row.session_id,
      csrfToken: row.csrf_token,
      ...(row.step_up_at ? { stepUpAt: row.step_up_at } : {})
    } : undefined;
  }

  private async storeChallenge(userId: string | undefined, purpose: "passkey_registration" | "passkey_login", challenge: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO auth_challenges (id, user_id, purpose, challenge, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '5 minutes')`,
      [randomUUID(), userId ?? null, purpose, challenge]
    );
  }

  private async consumeChallenge(userId: string | undefined, purpose: "passkey_registration" | "passkey_login"): Promise<string> {
    const result = await this.pool.query<{ id: string; challenge: string }>(
      `SELECT id, challenge FROM auth_challenges
       WHERE user_id IS NOT DISTINCT FROM $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [userId ?? null, purpose]
    );
    const row = result.rows[0];
    if (!row) throw new Error("The passkey request expired. Start again.");
    await this.pool.query("UPDATE auth_challenges SET used_at = now() WHERE id = $1", [row.id]);
    return row.challenge;
  }

  private async passkeys(userId: string): Promise<PasskeyRow[]> {
    const result = await this.pool.query<PasskeyRow>("SELECT * FROM passkeys WHERE user_id = $1", [userId]);
    return result.rows;
  }

  private transports(value: string[] | null): AuthenticatorTransportFuture[] | undefined {
    if (!value) return undefined;
    const permitted = new Set<AuthenticatorTransportFuture>(["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"]);
    const transports = value.filter((transport): transport is AuthenticatorTransportFuture => permitted.has(transport as AuthenticatorTransportFuture));
    return transports.length ? transports : undefined;
  }

  private async limit(scope: string, maximum: number, windowMs: number): Promise<void> {
    const result = await this.pool.query<{ count: number; window_started_at: Date }>(
      `INSERT INTO auth_rate_limits (scope, count, window_started_at) VALUES ($1, 1, now())
       ON CONFLICT (scope) DO UPDATE SET count = CASE
         WHEN auth_rate_limits.window_started_at < now() - ($2::text || ' milliseconds')::interval THEN 1
         ELSE auth_rate_limits.count + 1 END,
         window_started_at = CASE WHEN auth_rate_limits.window_started_at < now() - ($2::text || ' milliseconds')::interval THEN now() ELSE auth_rate_limits.window_started_at END
       RETURNING count, window_started_at`,
      [scope, windowMs]
    );
    if (result.rows[0].count > maximum) throw new Error("Too many requests. Try again later.");
  }

  private async event(userId: string | undefined, type: string, success: boolean): Promise<void> {
    await this.pool.query("INSERT INTO security_events (id, user_id, event_type, success) VALUES ($1, $2, $3, $4)", [randomUUID(), userId ?? null, type, success]);
  }

  private async eventWithClient(client: import("pg").PoolClient, userId: string | undefined, type: string, success: boolean): Promise<void> {
    await client.query("INSERT INTO security_events (id, user_id, event_type, success) VALUES ($1, $2, $3, $4)", [randomUUID(), userId ?? null, type, success]);
  }
}
