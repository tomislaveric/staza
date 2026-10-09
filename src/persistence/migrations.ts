import type { PoolClient } from "pg";
import { createActivityFingerprint } from "../activityFingerprint.js";
import type { ReplaySnapshot } from "../domain.js";

export interface Migration {
  id: string;
  up(client: PoolClient): Promise<void>;
}

export const migrations: Migration[] = [{
  id: "001_initial_player_activities",
  async up(client) {
    await client.query(`
      CREATE TABLE players (
        id UUID PRIMARY KEY,
        display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
        total_xp DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (total_xp >= 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE activities (
        id TEXT PRIMARY KEY,
        player_id UUID NOT NULL REFERENCES players(id),
        source_type TEXT NOT NULL CHECK (source_type = 'fit'),
        source_external_id TEXT,
        started_at TIMESTAMPTZ NOT NULL,
        distance_meters DOUBLE PRECISION CHECK (distance_meters IS NULL OR distance_meters >= 0),
        duration_seconds DOUBLE PRECISION CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
        xp_earned DOUBLE PRECISION NOT NULL CHECK (xp_earned >= 0),
        collected_count INTEGER NOT NULL CHECK (collected_count >= 0),
        has_video BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX activities_player_source_external_id_unique
        ON activities (player_id, source_type, source_external_id)
        WHERE source_external_id IS NOT NULL;
      CREATE INDEX activities_player_created_at_index
        ON activities (player_id, created_at DESC, id DESC);
      CREATE TABLE activity_events (
        id UUID PRIMARY KEY,
        activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK (event_type = 'collectible_collected'),
        activity_timestamp DOUBLE PRECISION NOT NULL,
        value DOUBLE PRECISION NOT NULL CHECK (value >= 0),
        latitude DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL,
        collectible_name TEXT NOT NULL CHECK (length(trim(collectible_name)) > 0),
        collectible_rarity TEXT CHECK (collectible_rarity IS NULL OR collectible_rarity IN ('common', 'rare', 'epic')),
        collectible_type TEXT NOT NULL CHECK (collectible_type IN ('coin', 'landmark')),
        UNIQUE (activity_id, source_id)
      );
      CREATE INDEX activity_events_activity_timestamp_index
        ON activity_events (activity_id, activity_timestamp, id);
    `);
  }
}, {
  id: "002_activity_event_fractional_timestamps",
  async up(client) {
    await client.query(`
      ALTER TABLE activity_events
        ALTER COLUMN activity_timestamp TYPE DOUBLE PRECISION
        USING activity_timestamp::DOUBLE PRECISION
    `);
  }
}, {
  id: "003_activity_replay_snapshots",
  async up(client) {
    await client.query(`
      ALTER TABLE activities
        ADD COLUMN replay_snapshot JSONB
    `);
  }
}, {
  id: "004_activity_video_media",
  async up(client) {
    await client.query(`
      CREATE TABLE activity_videos (
        activity_id TEXT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
        media_id UUID NOT NULL UNIQUE,
        source_filename TEXT NOT NULL CHECK (length(trim(source_filename)) > 0),
        source_path TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('syncing', 'sync_failed', 'awaiting_selection', 'rendering', 'succeeded', 'render_failed')),
        source_duration DOUBLE PRECISION CHECK (source_duration IS NULL OR source_duration >= 0),
        synchronization JSONB,
        mapped_events JSONB,
        selected_source_ids JSONB,
        render JSONB,
        output_path TEXT,
        output_filename TEXT,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }
}, {
  id: "005_activity_video_no_highlights",
  async up(client) {
    await client.query(`
      ALTER TABLE activity_videos DROP CONSTRAINT activity_videos_state_check;
      ALTER TABLE activity_videos ADD CONSTRAINT activity_videos_state_check
        CHECK (state IN ('syncing', 'sync_failed', 'no_highlights', 'awaiting_selection', 'rendering', 'succeeded', 'render_failed'));
    `);
  }
}, {
  id: "006_users_and_player_ownership",
  async up(client) {
    await client.query(`
      CREATE TABLE users (
        id UUID PRIMARY KEY,
        email TEXT NOT NULL UNIQUE CHECK (email = lower(trim(email))),
        email_verified_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ
      );
      ALTER TABLE players ADD COLUMN user_id UUID REFERENCES users(id);
      CREATE UNIQUE INDEX players_user_id_unique ON players (user_id) WHERE user_id IS NOT NULL;
    `);
  }
}, {
  id: "007_auth_credentials_and_sessions",
  async up(client) {
    await client.query(`
      CREATE TABLE passkeys (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        credential_id TEXT NOT NULL UNIQUE,
        public_key BYTEA NOT NULL,
        counter BIGINT NOT NULL DEFAULT 0,
        transports JSONB,
        device_type TEXT,
        backed_up BOOLEAN,
        name TEXT NOT NULL DEFAULT 'Passkey',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_used_at TIMESTAMPTZ
      );
      CREATE INDEX passkeys_user_id_index ON passkeys (user_id);
      CREATE TABLE auth_challenges (
        id UUID PRIMARY KEY,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        purpose TEXT NOT NULL CHECK (purpose IN ('passkey_registration', 'passkey_login', 'step_up')),
        challenge TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX auth_challenges_lookup_index ON auth_challenges (challenge, purpose, expires_at);
      CREATE TABLE email_codes (
        id UUID PRIMARY KEY,
        email TEXT NOT NULL,
        purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login', 'step_up')),
        code_hash TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 5),
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX email_codes_active_index ON email_codes (email, purpose, expires_at) WHERE used_at IS NULL;
      CREATE TABLE sessions (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        csrf_token TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        absolute_expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        step_up_at TIMESTAMPTZ
      );
      CREATE INDEX sessions_active_token_index ON sessions (token_hash, expires_at) WHERE revoked_at IS NULL;
      CREATE INDEX sessions_user_id_index ON sessions (user_id) WHERE revoked_at IS NULL;
      CREATE TABLE security_events (
        id UUID PRIMARY KEY,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        event_type TEXT NOT NULL,
        success BOOLEAN NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE auth_rate_limits (
        scope TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        window_started_at TIMESTAMPTZ NOT NULL
      );
    `);
  }
}, {
  id: "008_account_lifecycle",
  async up(client) {
    await client.query(`
      CREATE TABLE deletion_intents (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        confirmation_token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE media_cleanup_tasks (
        id UUID PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        attempts INTEGER NOT NULL DEFAULT 0,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }
}, {
  id: "009_activity_type",
  async up(client) {
    await client.query(`
      ALTER TABLE activities
        ADD COLUMN activity_type TEXT NOT NULL DEFAULT 'unknown'
        CHECK (activity_type IN ('cycling', 'running', 'hiking', 'walking', 'unknown'));
    `);
  }
}, {
  id: "010_collectibles",
  async up(client) {
    await client.query(`
      CREATE TABLE collectibles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        collectible_type TEXT NOT NULL CHECK (collectible_type IN ('coin', 'landmark')),
        rarity TEXT CHECK (rarity IS NULL OR rarity IN ('common', 'rare', 'epic')),
        latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
        longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
        radius_meters DOUBLE PRECISION NOT NULL CHECK (radius_meters > 0),
        value DOUBLE PRECISION NOT NULL CHECK (value >= 0),
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX collectibles_bbox_index ON collectibles (latitude, longitude);
    `);
  }
}, {
  id: "011_quests",
  async up(client) {
    await client.query(`
      CREATE TABLE quests (
        id UUID PRIMARY KEY,
        title TEXT NOT NULL CHECK (length(trim(title)) > 0),
        description TEXT,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
        created_by_player_id UUID NOT NULL REFERENCES players(id),
        source_activity_id TEXT REFERENCES activities(id) ON DELETE SET NULL,
        center_latitude DOUBLE PRECISION NOT NULL CHECK (center_latitude BETWEEN -90 AND 90),
        center_longitude DOUBLE PRECISION NOT NULL CHECK (center_longitude BETWEEN -180 AND 180),
        published_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX quests_published_bbox_index
        ON quests (center_latitude, center_longitude) WHERE status = 'published';
      CREATE INDEX quests_creator_index
        ON quests (created_by_player_id, created_at DESC);
      CREATE TABLE quest_collectibles (
        quest_id UUID NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
        collectible_id TEXT NOT NULL REFERENCES collectibles(id) ON DELETE RESTRICT,
        order_index INTEGER,
        PRIMARY KEY (quest_id, collectible_id)
      );
      CREATE INDEX quest_collectibles_collectible_index ON quest_collectibles (collectible_id);
      CREATE TABLE quest_routes (
        quest_id UUID PRIMARY KEY REFERENCES quests(id) ON DELETE CASCADE,
        source_activity_id TEXT REFERENCES activities(id) ON DELETE SET NULL,
        geometry JSONB NOT NULL,
        distance_meters DOUBLE PRECISION CHECK (distance_meters IS NULL OR distance_meters >= 0),
        activity_type TEXT CHECK (activity_type IN ('cycling', 'running', 'hiking', 'walking', 'unknown')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE quest_external_routes (
        id UUID PRIMARY KEY,
        quest_id UUID NOT NULL UNIQUE REFERENCES quests(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK (provider IN ('komoot')),
        url TEXT NOT NULL CHECK (length(url) <= 2048),
        title TEXT,
        distance_meters DOUBLE PRECISION CHECK (distance_meters IS NULL OR distance_meters >= 0),
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }
}, {
  id: "012_collectible_sources",
  async up(client) {
    await client.query(`
      ALTER TABLE collectibles DROP CONSTRAINT collectibles_collectible_type_check;
      ALTER TABLE collectibles ADD CONSTRAINT collectibles_collectible_type_check
        CHECK (collectible_type IN ('coin', 'landmark', 'mountain_pass'));
      ALTER TABLE collectibles
        ADD COLUMN elevation_m DOUBLE PRECISION
          CHECK (elevation_m IS NULL OR elevation_m BETWEEN -500 AND 9000),
        ADD COLUMN source_type TEXT,
        ADD COLUMN source_external_id TEXT,
        ADD COLUMN source_url TEXT,
        ADD COLUMN source_attribution TEXT,
        ADD COLUMN status TEXT NOT NULL DEFAULT 'published'
          CHECK (status IN ('published', 'archived'));
      CREATE UNIQUE INDEX collectibles_source_identity_unique
        ON collectibles (source_type, source_external_id)
        WHERE source_type IS NOT NULL;
    `);
  }
}, {
  id: "013_osm_collectible_metadata",
  async up(client) {
    await client.query(`
      ALTER TABLE collectibles
        ADD COLUMN primary_category TEXT
          CHECK (primary_category IS NULL OR primary_category IN ('viewpoint', 'peak', 'castle', 'waterfall', 'mountain_pass')),
        ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}',
        ADD COLUMN wikidata_qid TEXT
          CHECK (wikidata_qid IS NULL OR wikidata_qid ~ '^Q[1-9][0-9]*$'),
        ADD COLUMN wikipedia_reference TEXT,
        ADD COLUMN enrichment_metadata JSONB;
      CREATE INDEX collectibles_primary_category_index ON collectibles (primary_category);
    `);
  }
}, {
  id: "014_drop_external_routes",
  async up(client) {
    await client.query(`
      DROP TABLE IF EXISTS quest_external_routes;
    `);
  }
}, {
  id: "015_place_primary_category",
  async up(client) {
    await client.query(`
      ALTER TABLE collectibles DROP CONSTRAINT collectibles_primary_category_check;
      ALTER TABLE collectibles ADD CONSTRAINT collectibles_primary_category_check
        CHECK (primary_category IS NULL OR primary_category IN
          ('viewpoint', 'peak', 'castle', 'waterfall', 'place', 'mountain_pass'));
    `);
  }
}, {
  id: "016_global_collectible_radius_100m",
  async up(client) {
    await client.query(`
      UPDATE collectibles SET radius_meters = 100 WHERE radius_meters <> 100;
    `);
  }
}, {
  id: "019_fartleks",
  async up(client) {
    await client.query(`
      CREATE TABLE fartleks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        geometry JSONB NOT NULL,
        start_latitude DOUBLE PRECISION NOT NULL CHECK (start_latitude BETWEEN -90 AND 90),
        start_longitude DOUBLE PRECISION NOT NULL CHECK (start_longitude BETWEEN -180 AND 180),
        end_latitude DOUBLE PRECISION NOT NULL CHECK (end_latitude BETWEEN -90 AND 90),
        end_longitude DOUBLE PRECISION NOT NULL CHECK (end_longitude BETWEEN -180 AND 180),
        length_meters DOUBLE PRECISION NOT NULL CHECK (length_meters > 0),
        status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'archived')),
        direction_restricted BOOLEAN,
        source_type TEXT NOT NULL,
        source_external_id TEXT NOT NULL,
        source_attribution TEXT,
        source_metadata JSONB,
        suitability_score DOUBLE PRECISION NOT NULL CHECK (suitability_score BETWEEN 0 AND 100),
        suitability_reasons TEXT[] NOT NULL DEFAULT '{}',
        mapping_confidence DOUBLE PRECISION NOT NULL CHECK (mapping_confidence BETWEEN 0 AND 100),
        geometry_version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX fartleks_source_identity_unique
        ON fartleks (source_type, source_external_id);
      CREATE INDEX fartleks_bbox_index
        ON fartleks (start_latitude, start_longitude, end_latitude, end_longitude);

      CREATE TABLE fartlek_completions (
        id UUID PRIMARY KEY,
        fartlek_id TEXT NOT NULL REFERENCES fartleks(id) ON DELETE CASCADE,
        player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
        completed_at TIMESTAMPTZ NOT NULL,
        elapsed_time_s DOUBLE PRECISION NOT NULL CHECK (elapsed_time_s > 0),
        average_speed_mps DOUBLE PRECISION NOT NULL CHECK (average_speed_mps >= 0),
        max_speed_mps DOUBLE PRECISION CHECK (max_speed_mps IS NULL OR max_speed_mps >= 0),
        traversal_direction TEXT CHECK (traversal_direction IS NULL OR traversal_direction IN ('a_to_b', 'b_to_a')),
        fartlek_length_m_snapshot DOUBLE PRECISION NOT NULL CHECK (fartlek_length_m_snapshot > 0),
        fartlek_geometry_version_snapshot INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (activity_id, fartlek_id)
      );
      CREATE INDEX fartlek_completions_player_index
        ON fartlek_completions (player_id, completed_at DESC);
      CREATE INDEX fartlek_completions_fartlek_index
        ON fartlek_completions (fartlek_id);
    `);
  }
}, {
  id: "020_fartlek_geometry_bounds",
  async up(client) {
    await client.query(`
      ALTER TABLE fartleks
        ADD COLUMN IF NOT EXISTS bbox_min_latitude DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS bbox_max_latitude DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS bbox_min_longitude DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS bbox_max_longitude DOUBLE PRECISION;

      UPDATE fartleks AS f SET
        bbox_min_longitude = COALESCE(sub.min_lon, LEAST(f.start_longitude, f.end_longitude)),
        bbox_max_longitude = COALESCE(sub.max_lon, GREATEST(f.start_longitude, f.end_longitude)),
        bbox_min_latitude = COALESCE(sub.min_lat, LEAST(f.start_latitude, f.end_latitude)),
        bbox_max_latitude = COALESCE(sub.max_lat, GREATEST(f.start_latitude, f.end_latitude))
      FROM fartleks AS base
      LEFT JOIN LATERAL (
        SELECT
          min((coord->>0)::double precision) AS min_lon,
          max((coord->>0)::double precision) AS max_lon,
          min((coord->>1)::double precision) AS min_lat,
          max((coord->>1)::double precision) AS max_lat
        FROM jsonb_array_elements(base.geometry->'coordinates') AS coord
      ) AS sub ON true
      WHERE f.id = base.id
        AND (
          f.bbox_min_latitude IS NULL OR f.bbox_max_latitude IS NULL OR
          f.bbox_min_longitude IS NULL OR f.bbox_max_longitude IS NULL
        );

      ALTER TABLE fartleks
        ALTER COLUMN bbox_min_latitude SET NOT NULL,
        ALTER COLUMN bbox_max_latitude SET NOT NULL,
        ALTER COLUMN bbox_min_longitude SET NOT NULL,
        ALTER COLUMN bbox_max_longitude SET NOT NULL;

      CREATE INDEX IF NOT EXISTS fartleks_geometry_bbox_gist
        ON fartleks USING gist (
          box(
            point(bbox_min_longitude, bbox_min_latitude),
            point(bbox_max_longitude, bbox_max_latitude)
          )
        );
    `);
  }
}, {
  id: "021_strava_import_and_journey_start",
  async up(client) {
    await client.query(`
      ALTER TABLE players ADD COLUMN journey_started_at TIMESTAMPTZ;
      UPDATE players SET journey_started_at = first_activity.started_at
      FROM (
        SELECT DISTINCT ON (player_id) player_id, started_at
        FROM activities
        ORDER BY player_id, created_at, id
      ) AS first_activity
      WHERE first_activity.player_id = players.id;

      ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_source_type_check;
      ALTER TABLE activities ADD CONSTRAINT activities_source_type_check
        CHECK (source_type IN ('fit', 'strava'));
      ALTER TABLE activities
        ADD COLUMN fingerprint_version INTEGER,
        ADD COLUMN fingerprint_started_at TIMESTAMPTZ,
        ADD COLUMN fingerprint JSONB;
      CREATE INDEX activities_player_fingerprint_start_index
        ON activities (player_id, fingerprint_started_at)
        WHERE fingerprint IS NOT NULL;

      CREATE TABLE strava_connections (
        player_id UUID PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
        athlete_id BIGINT NOT NULL,
        scope TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reconnect_required')),
        access_token_ciphertext TEXT NOT NULL,
        refresh_token_ciphertext TEXT NOT NULL,
        access_token_expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE strava_oauth_states (
        id UUID PRIMARY KEY,
        state_hash TEXT NOT NULL UNIQUE,
        player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        return_locale TEXT NOT NULL DEFAULT 'en' CHECK (return_locale IN ('en', 'de')),
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX strava_oauth_states_player_index ON strava_oauth_states (player_id);
    `);
    await backfillActivityFingerprints(client);
  }
}, {
  id: "022_cascade_player_data_deletion",
  async up(client) {
    await client.query(`
      ALTER TABLE activities
        DROP CONSTRAINT activities_player_id_fkey,
        ADD CONSTRAINT activities_player_id_fkey
          FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
      ALTER TABLE quests
        DROP CONSTRAINT quests_created_by_player_id_fkey,
        ADD CONSTRAINT quests_created_by_player_id_fkey
          FOREIGN KEY (created_by_player_id) REFERENCES players(id) ON DELETE CASCADE;
    `);
  }
}, {
  id: "023_quest_templates_and_instances",
  async up(client) {
    await client.query(`
      CREATE TABLE quest_templates (
        id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version > 0),
        title TEXT NOT NULL CHECK (length(trim(title)) > 0),
        description TEXT NOT NULL CHECK (length(trim(description)) > 0),
        recommended_level INTEGER NOT NULL CHECK (recommended_level > 0),
        objectives JSONB NOT NULL CHECK (jsonb_typeof(objectives) = 'array'),
        onboarding BOOLEAN NOT NULL DEFAULT false,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (id, version)
      );
      CREATE INDEX quest_templates_active_index ON quest_templates (active, id, version DESC);

      CREATE TABLE quest_instances (
        id UUID PRIMARY KEY,
        player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        template_id TEXT NOT NULL,
        template_version INTEGER NOT NULL,
        scope_hash TEXT NOT NULL,
        title TEXT NOT NULL CHECK (length(trim(title)) > 0),
        description TEXT NOT NULL,
        recommended_level INTEGER NOT NULL CHECK (recommended_level > 0),
        objectives JSONB NOT NULL CHECK (jsonb_typeof(objectives) = 'array'),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
        started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        completed_at TIMESTAMPTZ,
        FOREIGN KEY (template_id, template_version)
          REFERENCES quest_templates(id, version) ON DELETE RESTRICT,
        UNIQUE (player_id, template_id, template_version, scope_hash),
        CHECK ((status = 'active' AND completed_at IS NULL)
          OR (status = 'completed' AND completed_at IS NOT NULL))
      );
      CREATE INDEX quest_instances_player_status_index
        ON quest_instances (player_id, status, started_at DESC);

      ALTER TABLE activity_events
        ADD COLUMN collectible_category TEXT
          CHECK (collectible_category IS NULL OR collectible_category IN
            ('viewpoint', 'peak', 'castle', 'waterfall', 'place', 'mountain_pass'));
      UPDATE activity_events AS events
      SET collectible_category = collectibles.primary_category
      FROM collectibles
      WHERE events.source_id = collectibles.id
        AND events.collectible_category IS NULL
        AND collectibles.primary_category IS NOT NULL;
      CREATE INDEX activity_events_category_history_index
        ON activity_events (collectible_category, source_id);
    `);
  }
}];

/** Derives fingerprints for already accepted activities from their persisted replay snapshots. */
export const backfillActivityFingerprints = async (client: PoolClient): Promise<void> => {
  let lastId = "";
  for (;;) {
    const batch = await client.query<{ id: string; replay_snapshot: ReplaySnapshot }>(
      `SELECT id, replay_snapshot FROM activities
       WHERE fingerprint IS NULL AND replay_snapshot IS NOT NULL AND id > $1
       ORDER BY id LIMIT 200`,
      [lastId]
    );
    if (batch.rowCount === 0) return;
    for (const row of batch.rows) {
      lastId = row.id;
      const snapshot = row.replay_snapshot.activity;
      if (!Array.isArray(snapshot?.route)) continue;
      const fingerprint = createActivityFingerprint({ type: snapshot.type ?? "unknown", route: snapshot.route });
      if (!fingerprint) continue;
      await client.query(
        `UPDATE activities SET fingerprint_version = $2, fingerprint_started_at = $3, fingerprint = $4 WHERE id = $1`,
        [row.id, fingerprint.version, new Date(fingerprint.startedAtMs), JSON.stringify(fingerprint)]
      );
    }
  }
};
