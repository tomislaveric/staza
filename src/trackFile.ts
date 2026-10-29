import { readFile } from "node:fs/promises";
import type { ActivityType, TrackPoint } from "./domain.js";
import { UserInputError } from "./errors.js";
import { mapFitSport, parseFitMetadata, parseFitTrack, type FitMetadata } from "./fit.js";

/** Sports a player may choose at import; "unknown" is deliberately not selectable. */
export const IMPORT_SPORTS = ["cycling", "running", "hiking"] as const;
export type ImportSport = (typeof IMPORT_SPORTS)[number];

/** Validates the required `sport` field of an activity import. */
export const parseImportSport = (value: unknown): ImportSport => {
  if (typeof value === "string" && (IMPORT_SPORTS as readonly string[]).includes(value)) return value as ImportSport;
  throw new UserInputError("Choose cycling, running, or hiking for this activity.");
};

export interface ParsedTrack {
  track: TrackPoint[];
  metadata: FitMetadata;
}

const MIN_ELEVATION_STEP_M = 3;

const decodeXml = (value: string): string => value
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&amp;/g, "&");

const firstText = (xml: string, tag: string): string | undefined => {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml);
  const text = match ? decodeXml(match[1]).trim() : "";
  return text.length > 0 ? text : undefined;
};

const attribute = (attributes: string, name: string): number => {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`).exec(attributes);
  return match ? Number(match[1]) : Number.NaN;
};

/** Ascent in metres from raw elevations, ignoring jitter below a minimum step. */
const elevationGain = (elevations: number[]): number | undefined => {
  if (elevations.length < 2) return undefined;
  let gain = 0;
  let reference = elevations[0];
  for (const elevation of elevations) {
    if (elevation - reference >= MIN_ELEVATION_STEP_M) {
      gain += elevation - reference;
      reference = elevation;
    } else if (reference - elevation >= MIN_ELEVATION_STEP_M) reference = elevation;
  }
  return gain;
};

/** Parses GPX tracks into timestamped points and metadata. `<type>` only hints at the sport. */
export const parseGpx = (source: string): ParsedTrack => {
  if (!/<gpx[\s>]/.test(source)) throw new UserInputError("GPX parsing failed: not a GPX document.");
  const points: TrackPoint[] = [];
  const elevations: number[] = [];
  const pointPattern = /<trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/trkpt>)/g;
  for (const match of source.matchAll(pointPattern)) {
    const latitude = attribute(match[1], "lat");
    const longitude = attribute(match[1], "lon");
    const time = firstText(match[2] ?? "", "time");
    const timestampMs = time === undefined ? Number.NaN : Date.parse(time);
    if (
      !Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(timestampMs)
      || Math.abs(latitude) > 90 || Math.abs(longitude) > 180
    ) continue;
    points.push({ latitude, longitude, timestampMs });
    const elevation = Number(firstText(match[2] ?? "", "ele"));
    if (firstText(match[2] ?? "", "ele") !== undefined && Number.isFinite(elevation)) elevations.push(elevation);
  }
  if (points.length < 2) throw new UserInputError("GPX file needs at least two track points with timestamps.");
  points.sort((left, right) => left.timestampMs - right.timestampMs);

  const track = /<trk\b[^>]*>([\s\S]*?)<\/trk>/.exec(source)?.[1] ?? "";
  const withoutPoints = track.replace(/<trkseg\b[\s\S]*?<\/trkseg>/g, "");
  const header = /<metadata\b[^>]*>([\s\S]*?)<\/metadata>/.exec(source)?.[1] ?? "";
  const title = firstText(withoutPoints, "name") ?? firstText(header, "name");
  const description = firstText(withoutPoints, "desc") ?? firstText(header, "desc");
  const trackType = firstText(withoutPoints, "type")?.toLowerCase();
  // Only trust ascent when most points carry an elevation.
  const gain = elevations.length >= points.length * 0.8 ? elevationGain(elevations) : undefined;
  return {
    track: points,
    metadata: {
      activityType: mapFitSport(trackType === "biking" ? "cycling" : trackType),
      ...(title === undefined ? {} : { title }),
      ...(description === undefined ? {} : { description }),
      ...(gain === undefined ? {} : { elevationGainM: gain })
    }
  };
};

/** FIT files carry ".FIT" at bytes 8-11 of the header; anything else must be GPX XML. */
export const detectTrackFormat = (head: Buffer): "fit" | "gpx" =>
  head.length >= 12 && head.subarray(8, 12).toString("latin1") === ".FIT" ? "fit" : "gpx";

export const parseTrackFile = async (file: string): Promise<ParsedTrack> => {
  const source = await readFile(file);
  if (detectTrackFormat(source) === "fit") {
    const [track, metadata] = await Promise.all([parseFitTrack(file), parseFitMetadata(file)]);
    return { track, metadata };
  }
  return parseGpx(source.toString("utf8"));
};

/** The sport a file declares, if any, used only to prefill the import form. */
export const declaredSport = (activityType: ActivityType): ImportSport | undefined =>
  (IMPORT_SPORTS as readonly string[]).includes(activityType) ? (activityType as ImportSport) : undefined;
