import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuthenticationError, AuthService, EmailSender } from "./auth.js";
import { createDatabasePool } from "./persistence/database.js";
import { migrate } from "./persistence/migrate.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeAuth = databaseUrl ? describe : describe.skip;
const pool = databaseUrl ? createDatabasePool(databaseUrl) : undefined;
const auth = pool ? new AuthService(pool, { production: false }, new EmailSender(false)) : undefined;

const codeHash = (value: string): string => createHash("sha256").update(value).digest("hex");

describeAuth("AuthService", () => {
  beforeEach(async () => {
    await migrate(pool!);
    await pool!.query("TRUNCATE sessions, passkeys, auth_challenges, email_codes, security_events, auth_rate_limits, players, users CASCADE");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("creates a Player before issuing an email-login session for a legacy account", async () => {
    const userId = randomUUID();
    const email = "legacy@example.test";
    await pool!.query("INSERT INTO users (id, email, email_verified_at) VALUES ($1, $2, now())", [userId, email]);
    await pool!.query(
      `INSERT INTO email_codes (id, email, purpose, code_hash, expires_at)
       VALUES ($1, $2, 'login', $3, now() + interval '10 minutes')`,
      [randomUUID(), email, codeHash("123456")]
    );

    const session = await auth!.emailLogin(email, "123456");

    expect(session.user).toMatchObject({ id: userId, email });
    expect(session.sessionToken).toEqual(expect.any(String));
    expect(await pool!.query("SELECT user_id FROM players WHERE user_id = $1", [userId])).toMatchObject({
      rowCount: 1,
      rows: [{ user_id: userId }]
    });
  });

  it("deletes the account and all player-owned data", async () => {
    const userId = randomUUID();
    const playerId = randomUUID();
    const email = "delete@example.test";
    const activityId = "activity-to-delete";
    const videoPath = "/tmp/account-deletion/source.mp4";
    await pool!.query("INSERT INTO users (id, email, email_verified_at) VALUES ($1, $2, now())", [userId, email]);
    await pool!.query("INSERT INTO players (id, user_id, display_name) VALUES ($1, $2, $3)", [playerId, userId, "Delete me"]);
    await pool!.query(
      `INSERT INTO activities (id, player_id, source_type, started_at, xp_earned, collected_count)
       VALUES ($1, $2, 'fit', now(), 0, 0)`,
      [activityId, playerId]
    );
    await pool!.query(
      `INSERT INTO activity_videos (activity_id, media_id, source_filename, source_path, state)
       VALUES ($1, $2, 'source.mp4', $3, 'syncing')`,
      [activityId, randomUUID(), videoPath]
    );
    await pool!.query(
      `INSERT INTO quests (id, title, created_by_player_id, center_latitude, center_longitude)
       VALUES ($1, 'My quest', $2, 49, 8)`,
      [randomUUID(), playerId]
    );
    await pool!.query(
      `INSERT INTO email_codes (id, email, purpose, code_hash, expires_at)
       VALUES ($1, $2, 'login', $3, now() + interval '10 minutes')`,
      [randomUUID(), email, codeHash("123456")]
    );

    await pool!.query("INSERT INTO security_events (id, user_id, event_type, success) VALUES ($1, $2, 'login', true)", [randomUUID(), userId]);

    const user = {
      id: userId,
      email,
      emailVerified: true,
      playerId,
      sessionId: randomUUID(),
      csrfToken: "csrf",
      stepUpAt: new Date()
    };
    const intent = await auth!.createDeletionIntent(user);
    const mediaPaths = await auth!.confirmDeletion(user, intent.confirmationToken);

    expect(mediaPaths).toEqual([videoPath]);
    expect(await pool!.query("SELECT id FROM users WHERE id = $1", [userId])).toMatchObject({ rowCount: 0 });
    expect(await pool!.query("SELECT id FROM players WHERE id = $1", [playerId])).toMatchObject({ rowCount: 0 });
    expect(await pool!.query("SELECT id FROM activities WHERE id = $1", [activityId])).toMatchObject({ rowCount: 0 });
    expect(await pool!.query("SELECT id FROM quests WHERE created_by_player_id = $1", [playerId])).toMatchObject({ rowCount: 0 });
    expect(await pool!.query("SELECT id FROM email_codes WHERE email = $1", [email])).toMatchObject({ rowCount: 0 });
    expect(await pool!.query("SELECT id FROM security_events")).toMatchObject({ rowCount: 0 });

    const otherPlayerId = randomUUID();
    await pool!.query("INSERT INTO players (id, display_name) VALUES ($1, 'Other')", [otherPlayerId]);
    await pool!.query(
      `INSERT INTO activities (id, player_id, source_type, started_at, xp_earned, collected_count)
       VALUES ($1, $2, 'fit', now(), 0, 0)`,
      [activityId, otherPlayerId]
    );
  });
  const nativeLogin = async (email: string) => {
    await pool!.query("INSERT INTO users (id, email, email_verified_at) VALUES ($1, $2, now())", [randomUUID(), email]);
    await pool!.query(
      `INSERT INTO email_codes (id, email, purpose, code_hash, expires_at)
       VALUES ($1, $2, 'login', $3, now() + interval '10 minutes')`,
      [randomUUID(), email, codeHash("123456")]
    );
    return auth!.emailLogin(email, "123456", { native: true });
  };

  it("issues native credentials only when opted in, without disturbing web sessions", async () => {
    const native = await nativeLogin("native@example.test");
    expect(native.native).toMatchObject({ tokenType: "Bearer", accessToken: native.sessionToken });
    expect((await auth!.getSessionUser(native.native!.accessToken))?.email).toBe("native@example.test");

    await pool!.query(
      `INSERT INTO email_codes (id, email, purpose, code_hash, expires_at)
       VALUES ($1, 'native@example.test', 'login', $2, now() + interval '10 minutes')`,
      [randomUUID(), codeHash("654321")]
    );
    const web = await auth!.emailLogin("native@example.test", "654321");
    expect(web.native).toBeUndefined();
    expect(await auth!.getSessionUser(native.native!.accessToken)).toBeDefined();
    expect(await auth!.getSessionUser(web.sessionToken)).toBeDefined();
  });

  it("rotates refresh credentials, rejects replay, and revokes the session on replay", async () => {
    const { native } = await nativeLogin("refresh@example.test");
    const rotated = await auth!.refreshNativeSession(native!.refreshToken);
    expect(rotated.refreshToken).not.toBe(native!.refreshToken);
    expect(await auth!.getSessionUser(native!.accessToken)).toBeUndefined();
    expect((await auth!.getSessionUser(rotated.accessToken))?.email).toBe("refresh@example.test");

    await expect(auth!.refreshNativeSession(native!.refreshToken)).rejects.toThrow(AuthenticationError);
    expect(await auth!.getSessionUser(rotated.accessToken)).toBeUndefined();
    await expect(auth!.refreshNativeSession(rotated.refreshToken)).rejects.toThrow(AuthenticationError);
  });

  it("rejects expired access credentials and logout revokes native sessions", async () => {
    const { native } = await nativeLogin("expiry@example.test");
    await pool!.query("UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE kind = 'native'");
    expect(await auth!.getSessionUser(native!.accessToken)).toBeUndefined();
    const refreshed = await auth!.refreshNativeSession(native!.refreshToken);
    expect(await auth!.getSessionUser(refreshed.accessToken)).toBeDefined();

    await auth!.logout(refreshed.accessToken);
    expect(await auth!.getSessionUser(refreshed.accessToken)).toBeUndefined();
    await expect(auth!.refreshNativeSession(refreshed.refreshToken)).rejects.toThrow(AuthenticationError);
  });

  it("logout-all revokes every native session", async () => {
    const first = await nativeLogin("all@example.test");
    const user = (await auth!.getSessionUser(first.native!.accessToken))!;
    await auth!.logoutAll(user.id);
    expect(await auth!.getSessionUser(first.native!.accessToken)).toBeUndefined();
    await expect(auth!.refreshNativeSession(first.native!.refreshToken)).rejects.toThrow(AuthenticationError);
  });
});
