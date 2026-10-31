import { readFile } from "node:fs/promises";
import FitParser from "fit-file-parser";
import type { ActivityType, TrackPoint } from "./domain.js";
import { UserInputError } from "./errors.js";
import { synchronizationFailure } from "./synchronization.js";

interface FitRecord {
  position_lat?: number;
  position_long?: number;
  timestamp?: Date | string | number;
}

interface FitData {
  records?: FitRecord[];
}

type FitMessage = Record<string, unknown>;

interface FitMetadataSource {
  workout?: FitMessage;
  workouts?: FitMessage[];
  session?: FitMessage;
  sessions?: FitMessage[];
  sport?: FitMessage;
  sports?: FitMessage[];
}

export interface FitMetadata {
  title?: string;
  description?: string;
  elevationGainM?: number;
  activityType: ActivityType;
}

const FIT_SPORTS: Record<string, ActivityType> = {
  cycling: "cycling",
  e_biking: "cycling",
  running: "running",
  hiking: "hiking"
};

const normalizeFitName = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";

/** Maps FIT sport/sub-sport names to a supported activity type; anything else stays unknown. */
export const mapFitSport = (sport: unknown, subSport?: unknown): ActivityType =>
  FIT_SPORTS[normalizeFitName(sport)] ?? FIT_SPORTS[normalizeFitName(subSport)] ?? "unknown";

/** A trimmed, non-empty string candidate, or undefined when blank/unreliable. */
const usableText = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/** A finite, non-negative elevation-gain candidate in metres, or undefined. */
const usableElevation = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

const firstMessage = (
  single: FitMessage | undefined,
  list: FitMessage[] | undefined
): FitMessage | undefined => single ?? list?.[0];

/**
 * Extracts a human ride title/description from parsed FIT name fields. Only well-known,
 * reliable name fields are considered; everything else resolves to `undefined` so callers
 * can fall back to an activity-type label.
 */
export const extractFitMetadata = (data: FitMetadataSource): FitMetadata => {
  const workout = firstMessage(data.workout, data.workouts);
  const session = firstMessage(data.session, data.sessions);
  const title = usableText(workout?.wkt_name)
    ?? usableText(session?.sport_profile_name)
    ?? usableText(session?.name);
  const description = usableText(workout?.notes) ?? usableText(session?.notes);
  const elevationGainM = usableElevation(session?.total_ascent);
  const sportMessage = firstMessage(data.sport, data.sports);
  const activityType = mapFitSport(
    session?.sport ?? sportMessage?.sport,
    session?.sub_sport ?? sportMessage?.sub_sport
  );
  return {
    activityType,
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(elevationGainM === undefined ? {} : { elevationGainM })
  };
};

export const usableFitTrackPoints = (records: FitRecord[]): TrackPoint[] => {
  const points = records
    .map((record): TrackPoint | undefined => {
      if (
        typeof record.position_lat !== "number" ||
        typeof record.position_long !== "number" ||
        !Number.isFinite(record.position_lat) ||
        !Number.isFinite(record.position_long) ||
        Math.abs(record.position_lat) > 90 ||
        Math.abs(record.position_long) > 180 ||
        record.timestamp === undefined
      ) {
        return undefined;
      }
      const timestampMs = new Date(record.timestamp).getTime();
      if (!Number.isFinite(timestampMs)) return undefined;
      return {
        latitude: record.position_lat,
        longitude: record.position_long,
        timestampMs
      };
    })
    .filter((point): point is TrackPoint => point !== undefined)
    .sort((left, right) => left.timestampMs - right.timestampMs);

  if (points.length < 2) throw synchronizationFailure("INVALID_FIT_TIMESTAMPS");
  return points;
};

export const parseFitTrack = async (file: string): Promise<TrackPoint[]> => {
  const source = await readFile(file);
  const parser = new FitParser({ force: true, speedUnit: "m/s", lengthUnit: "m" });
  let data: FitData;
  try {
    data = await parser.parseAsync(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UserInputError(`FIT parsing failed: ${message}`);
  }

  return usableFitTrackPoints(data.records ?? []);
};

export const parseFitMetadata = async (file: string): Promise<FitMetadata> => {
  const source = await readFile(file);
  const parser = new FitParser({ force: true, speedUnit: "m/s", lengthUnit: "m" });
  let data: FitMetadataSource;
  try {
    data = (await parser.parseAsync(source)) as FitMetadataSource;
  } catch {
    return { activityType: "unknown" };
  }
  return extractFitMetadata(data);
};
