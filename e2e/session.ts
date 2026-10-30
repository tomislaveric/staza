import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const envFile = path.resolve(".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const token = (): string => randomBytes(32).toString("base64url");
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/**
 * Creates a server-side session for browser tests without a passkey ceremony.
 * The user and player are created when missing so the suite also runs on an empty database.
 */
export const createTestSession = async (email: string): Promise<{ token: string; activityId?: string }> => {
  const connectionString = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL (or E2E_DATABASE_URL) is required for browser tests.");
  const pool = new pg.Pool({ connectionString });
  try {
    await pool.query(
      `INSERT INTO users (id, email, email_verified_at)
       SELECT $1::uuid, $2::text, now()
       WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = $2::text AND deleted_at IS NULL)`,
      [randomUUID(), email]
    );
    const user = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL", [email]);
    const userId = user.rows[0].id;
    await pool.query(
      `INSERT INTO players (id, display_name, user_id)
       SELECT $1::uuid, split_part($3::text, '@', 1), $2::uuid
       WHERE NOT EXISTS (SELECT 1 FROM players WHERE user_id = $2::uuid)`,
      [randomUUID(), userId, email]
    );
    const value = token();
    await pool.query(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at, absolute_expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '1 day', now() + interval '1 day')`,
      [randomUUID(), userId, sha256(value), token()]
    );
    const activity = await pool.query<{ id: string }>(
      `SELECT activities.id FROM activities
       INNER JOIN players ON players.id = activities.player_id
       WHERE players.user_id = $1 ORDER BY activities.started_at DESC LIMIT 1`,
      [userId]
    );
    return { token: value, activityId: activity.rows[0]?.id };
  } finally {
    await pool.end();
  }
};
