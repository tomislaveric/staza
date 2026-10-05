import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { CollectibleCategory } from "../domain.js";
import { OSM_CATEGORY_ORDER, type OSMCandidate, type OSMRecord } from "./model.js";

const categoryMatchers: Record<Exclude<CollectibleCategory, "mountain_pass">, (tags: Record<string, string>) => boolean> = {
  viewpoint: (tags) => tags.tourism === "viewpoint",
  peak: (tags) => tags.natural === "peak",
  castle: (tags) => tags.historic === "castle",
  waterfall: (tags) => tags.waterway === "waterfall",
  place: (tags) => tags.place === "square" || tags.place === "quarter" || tags.tourism === "attraction"
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isCoordinate = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
const parseMeasurement = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*(?:m|meter|metres)?$/i);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export interface RejectedOSMRecord {
  osmType?: string;
  osmId?: string;
  reason: string;
}

export type OSMNormalizeResult =
  | { ok: true; candidate: OSMCandidate }
  | { ok: false; rejection: RejectedOSMRecord };

export const normalizeOSMRecord = (input: unknown): OSMNormalizeResult => {
  if (!isRecord(input)) return { ok: false, rejection: { reason: "Record is not an object." } };
  const osmType = input.osmType;
  const osmId = typeof input.osmId === "string" ? input.osmId : "";
  const identity = {
    ...(typeof osmType === "string" ? { osmType } : {}),
    ...(osmId ? { osmId } : {})
  };
  if (osmType !== "node" && osmType !== "way" && osmType !== "relation") {
    return { ok: false, rejection: { ...identity, reason: "Invalid OSM object type." } };
  }
  if (!/^[1-9]\d*$/.test(osmId)) {
    return { ok: false, rejection: { ...identity, reason: "Invalid OSM object id." } };
  }
  if (!isCoordinate(input.latitude, -90, 90) || !isCoordinate(input.longitude, -180, 180)) {
    return { ok: false, rejection: { ...identity, reason: "Invalid representative coordinates." } };
  }
  if (!isRecord(input.tags) || Object.values(input.tags).some((value) => typeof value !== "string")) {
    return { ok: false, rejection: { ...identity, reason: "Invalid OSM tags." } };
  }
  const tags = input.tags as Record<string, string>;
  const categories = OSM_CATEGORY_ORDER.filter((category) => categoryMatchers[category](tags));
  if (categories.length === 0) {
    return { ok: false, rejection: { ...identity, reason: "Object does not match an imported category." } };
  }
  const rawName = tags["name:de"]?.trim() || tags.name?.trim();
  const meaningfulName = rawName && !/^(?:unnamed|unbenannt|unknown|no name|ohne namen|namenlos|peak|castle|burg|schloss|ruine|waterfall|wasserfall|viewpoint|aussicht|aussichtspunkt|gipfel|platz|marktplatz|square|quarter|viertel|stadtteil|altstadt|attraction|sehenswürdigkeit|\?|-|n\/a)$/i.test(rawName)
    ? rawName
    : undefined;
  if (rawName && !meaningfulName) {
    return { ok: false, rejection: { ...identity, reason: "OSM name is not meaningful." } };
  }
  if (categories[0] === "place" && !meaningfulName) {
    return { ok: false, rejection: { ...identity, reason: "Place candidate has no meaningful name." } };
  }
  const wikidataQid = tags.wikidata?.trim();
  if (wikidataQid && !/^Q[1-9]\d*$/.test(wikidataQid)) {
    return { ok: false, rejection: { ...identity, reason: "Invalid Wikidata Q-ID tag." } };
  }
  const wikipediaReference = tags.wikipedia?.trim() || undefined;
  const catalogTags = new Set<string>();
  if (tags.tourism === "viewpoint") catalogTags.add("viewpoint");
  if (tags.historic || tags.heritage) catalogTags.add("historic");
  if (tags.natural === "peak") catalogTags.add("summit");
  if (tags.place === "square") catalogTags.add("square");
  if (tags.place === "quarter") catalogTags.add("quarter");
  if (tags.tourism === "attraction") catalogTags.add("attraction");
  catalogTags.delete(categories[0]);
  const elevationMeters = parseMeasurement(tags.ele);
  if (tags.ele !== undefined && (
    elevationMeters === undefined || elevationMeters < -500 || elevationMeters > 9_000
  )) {
    return { ok: false, rejection: { ...identity, reason: "Invalid elevation value." } };
  }

  const record: OSMRecord = {
    osmType,
    osmId,
    latitude: input.latitude,
    longitude: input.longitude,
    tags
  };
  return {
    ok: true,
    candidate: {
      ...record,
      id: `osm:${osmType}:${osmId}`,
      ...(meaningfulName === undefined ? {} : { name: meaningfulName }),
      primaryCategory: categories[0],
      categories,
      tagsForCatalog: [...catalogTags].sort(),
      ...(elevationMeters === undefined ? {} : { elevationMeters }),
      ...(wikidataQid === undefined || wikidataQid === "" ? {} : { wikidataQid }),
      ...(wikipediaReference === undefined ? {} : { wikipediaReference }),
      wikipediaSitelinkMatched: false
    }
  };
};

interface NormalizationAccumulator {
  candidates: Map<string, OSMCandidate>;
  rejected: RejectedOSMRecord[];
  scanned: number;
}

const createAccumulator = (): NormalizationAccumulator => ({
  candidates: new Map(),
  rejected: [],
  scanned: 0
});

const addJsonLine = (line: string, result: NormalizationAccumulator): void => {
  if (line.trim() === "") return;
  result.scanned += 1;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    result.rejected.push({ reason: "Malformed JSONL record." });
    return;
  }
  const normalized = normalizeOSMRecord(parsed);
  if (!normalized.ok) {
    result.rejected.push(normalized.rejection);
    return;
  }
  const identity = normalized.candidate.id;
  if (result.candidates.has(identity)) {
    result.rejected.push({
      osmType: normalized.candidate.osmType,
      osmId: normalized.candidate.osmId,
      reason: "Duplicate OSM source identity."
    });
    return;
  }
  result.candidates.set(identity, normalized.candidate);
};

const finishNormalization = (result: NormalizationAccumulator) => ({
  candidates: [...result.candidates.values()].sort((left, right) => left.id.localeCompare(right.id)),
  rejected: result.rejected,
  scanned: result.scanned
});

export const normalizeOSMJsonLines = (contents: string) => {
  const result = createAccumulator();
  for (const line of contents.split(/\r?\n/)) addJsonLine(line, result);
  return finishNormalization(result);
};

export const normalizeOSMRecords = (records: unknown[]) => {
  const result = createAccumulator();
  for (const record of records) {
    result.scanned += 1;
    const normalized = normalizeOSMRecord(record);
    if (!normalized.ok) {
      result.rejected.push(normalized.rejection);
      continue;
    }
    const identity = normalized.candidate.id;
    if (result.candidates.has(identity)) {
      result.rejected.push({
        osmType: normalized.candidate.osmType,
        osmId: normalized.candidate.osmId,
        reason: "Duplicate OSM source identity."
      });
      continue;
    }
    result.candidates.set(identity, normalized.candidate);
  }
  return finishNormalization(result);
};

export const readOSMJsonLines = async (file: string) => {
  const result = createAccumulator();
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of lines) addJsonLine(line, result);
  return finishNormalization(result);
};
