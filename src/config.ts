import { existsSync } from "node:fs";
import path from "node:path";
import { DEFAULT_OSM_SNAPSHOT_FILE } from "./osm/snapshot.js";

const envFile = path.resolve(".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const integerEnv = (name: string, fallback: number): number => {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
};

const nonNegativeIntegerEnv = (name: string, fallback: number): number => {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
};

const decimalEnv = (name: string, fallback: number): number => {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number.`);
  return parsed;
};

const booleanEnv = (name: string, fallback: boolean): boolean => {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
};

const optionalUrlEnv = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(`${name} must be a valid origin URL.`);
  }
};

const httpsUrlEnv = (name: string, fallback: string): string => {
  const value = process.env[name]?.trim() || fallback;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${name} must use https.`);
  return parsed.toString();
};

const uuidEnv = (name: string, fallback: string): string => {
  const value = process.env[name] ?? fallback;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${name} must be a UUID.`);
  }
  return value;
};

const smtpPasswordEnv = (): string | undefined => {
  const encoded = process.env.SMTP_PASSWORD_BASE64?.trim();
  if (encoded) {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    if (Buffer.from(decoded, "utf8").toString("base64") !== encoded) {
      throw new Error("SMTP_PASSWORD_BASE64 must be valid base64.");
    }
    return decoded;
  }
  return process.env.SMTP_PASSWORD || undefined;
};

export const config = {
  port: integerEnv("PORT", 3000),
  dataDir: path.resolve(process.env.DATA_DIR ?? "./data/jobs"),
  mediaDir: path.resolve(process.env.MEDIA_DIR ?? "./data/media"),
  collectibleSeedFile: path.resolve(process.env.COLLECTIBLE_SEED_FILE ?? "./fixtures/world-v1-seed.json"),
  maxUploadBytes: integerEnv("MAX_UPLOAD_BYTES", 6 * 1024 * 1024 * 1024),
  jobTtlMs: integerEnv("JOB_TTL_MS", 30 * 60 * 1000),
  selectionTtlMs: integerEnv("SELECTION_TTL_MS", 30 * 60 * 1000),
  maxSelectedCoins: integerEnv("MAX_SELECTED_COINS", 20),
  maxOutputDurationSeconds: integerEnv("MAX_OUTPUT_DURATION_SECONDS", 120),
  processTimeoutMs: integerEnv("PROCESS_TIMEOUT_MS", 15 * 60 * 1000),
  hudEnabled: booleanEnv("HUD_ENABLED", true),
  minimapEnabled: booleanEnv("MINIMAP_ENABLED", true),
  eventFeedEnabled: booleanEnv("EVENT_FEED_ENABLED", true),
  nextItemEnabled: booleanEnv("NEXT_ITEM_ENABLED", true),
  mapRangeMeters: decimalEnv("MAP_RANGE_METERS", 150),
  eventFeedDurationSeconds: decimalEnv("EVENT_FEED_DURATION_SECONDS", 4),
  eventFeedMaxItems: integerEnv("EVENT_FEED_MAX_ITEMS", 3),
  hudFrameRate: integerEnv("HUD_FRAME_RATE", 10),
  showLegacyCoinOverlay: booleanEnv("SHOW_LEGACY_COIN_OVERLAY", false),
  fitSampleGapWarningSeconds: decimalEnv("FIT_SAMPLE_GAP_WARNING_SECONDS", 30),
  worldQueryPaddingMeters: decimalEnv("WORLD_QUERY_PADDING_METERS", 500),
  worldViewportLimit: integerEnv("WORLD_VIEWPORT_LIMIT", 300),
  basemapStyleUrl: httpsUrlEnv("BASEMAP_STYLE_URL", "https://tiles.openfreemap.org/styles/liberty"),
  basemapAttribution: process.env.BASEMAP_ATTRIBUTION?.trim()
    || "\u00a9 OpenFreeMap \u00b7 \u00a9 OpenMapTiles \u00b7 \u00a9 OpenStreetMap contributors",
  basemapExtraOrigins: (process.env.BASEMAP_EXTRA_ORIGINS?.trim() || "")
    .split(",").map((value) => value.trim()).filter((value) => value !== "")
    .map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        throw new Error("BASEMAP_EXTRA_ORIGINS must be a comma-separated list of origin URLs.");
      }
    }),
  questRouteMaxPoints: integerEnv("QUEST_ROUTE_MAX_POINTS", 2000),
  quaeldichGeoJsonUrl: httpsUrlEnv(
    "QUAELDICH_GEOJSON_URL",
    "https://www.quaeldich.de/common/js/paesse_geojson.php?license=odbl"
  ),
  osmSnapshotFile: path.resolve(process.env.OSM_SNAPSHOT_FILE?.trim() || DEFAULT_OSM_SNAPSHOT_FILE),
  wikidataCacheDir: path.resolve(process.env.OSM_WIKIDATA_CACHE_DIR ?? "./data/osm-wikidata-cache"),
  wikidataBatchDelayMs: nonNegativeIntegerEnv("WIKIDATA_BATCH_DELAY_MS", 5_000),
  wikidataMaxAttempts: integerEnv("WIKIDATA_MAX_ATTEMPTS", 5),
  mountainPassDefaultRadiusMeters: decimalEnv("MOUNTAIN_PASS_DEFAULT_RADIUS_M", 100),
  databaseUrl: process.env.DATABASE_URL?.trim(),
  defaultPlayerId: uuidEnv("DEFAULT_PLAYER_ID", "00000000-0000-4000-8000-000000000001"),
  defaultPlayerName: process.env.DEFAULT_PLAYER_NAME?.trim() || "Local player",
  nodeEnv: process.env.NODE_ENV ?? "development",
  webauthnRpId: process.env.WEBAUTHN_RP_ID?.trim(),
  webauthnRpName: process.env.WEBAUTHN_RP_NAME?.trim(),
  webauthnOrigin: optionalUrlEnv("WEBAUTHN_ORIGIN"),
  devAuthEmail: process.env.DEV_AUTH_EMAIL?.trim().toLowerCase(),
  devAuthPlayerId: process.env.DEV_AUTH_PLAYER_ID?.trim(),
  devAuthPlayerName: process.env.DEV_AUTH_PLAYER_NAME?.trim() || "Development player",
  smtpHost: process.env.SMTP_HOST?.trim() || undefined,
  smtpPort: integerEnv("SMTP_PORT", 587),
  smtpSecure: booleanEnv("SMTP_SECURE", false),
  smtpUser: process.env.SMTP_USER?.trim() || undefined,
  smtpPassword: smtpPasswordEnv(),
  mailFrom: process.env.MAIL_FROM?.trim() || undefined
};

if (config.nodeEnv === "production") {
  if (!config.webauthnRpId || !config.webauthnRpName || !config.webauthnOrigin || !config.webauthnOrigin.startsWith("https://")) {
    throw new Error("Production requires HTTPS WEBAUTHN_RP_ID, WEBAUTHN_RP_NAME, and WEBAUTHN_ORIGIN.");
  }
  if (config.devAuthEmail || config.devAuthPlayerId) throw new Error("Development authentication bootstrap is not allowed in production.");
  if (!config.smtpHost || !config.smtpUser || !config.smtpPassword || !config.mailFrom) {
    throw new Error("Production requires SMTP_HOST, SMTP_USER, SMTP_PASSWORD (or SMTP_PASSWORD_BASE64), and MAIL_FROM for email delivery.");
  }
}
