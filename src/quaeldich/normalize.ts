import type { Collectible } from "../domain.js";
import { mountainPassValueFromElevation } from "./value.js";

export const QUAELDICH_SOURCE_TYPE = "quaeldich";
export const QUAELDICH_ATTRIBUTION = "quäldich.de";
export const MOUNTAIN_PASS_CATEGORY = "mountain_pass";

export interface QuaeldichFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { TextID: string; name: string; ele?: number | null };
}

export interface NormalizeOptions {
  radiusMeters: number;
}

export interface RejectedFeature {
  reason: string;
  textId?: string;
  name?: string;
}

export type NormalizeResult =
  | { ok: true; collectible: Collectible }
  | { ok: false; rejection: RejectedFeature };

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const passDeeplink = (textId: string): string =>
  `https://www.quaeldich.de/paesse/${encodeURIComponent(textId)}/`;

export const passCollectibleId = (textId: string): string => `${QUAELDICH_SOURCE_TYPE}:${textId}`;

/**
 * Normalizes one official quäldich GeoJSON feature into a canonical Staza collectible.
 * Pure and network-free: only the licensed elementary fields (name, coordinates,
 * elevation, TextID) are mapped. Malformed records are rejected, never coerced.
 */
export const normalizeQuaeldichFeature = (
  feature: unknown,
  { radiusMeters }: NormalizeOptions
): NormalizeResult => {
  if (typeof feature !== "object" || feature === null) {
    return { ok: false, rejection: { reason: "Feature is not an object." } };
  }
  const candidate = feature as Record<string, unknown>;
  const geometry = candidate.geometry as Record<string, unknown> | undefined;
  const properties = (candidate.properties ?? {}) as Record<string, unknown>;

  const textIdRaw = properties.TextID;
  const textId = typeof textIdRaw === "string" ? textIdRaw.trim() : "";
  const name = typeof properties.name === "string" ? properties.name.trim() : "";

  if (textId === "") {
    return { ok: false, rejection: { reason: "Missing TextID.", name: name || undefined } };
  }
  if (name === "") {
    return { ok: false, rejection: { reason: "Missing name.", textId } };
  }
  if (!geometry || geometry.type !== "Point" || !Array.isArray(geometry.coordinates)) {
    return { ok: false, rejection: { reason: "Invalid geometry.", textId, name } };
  }
  const [longitude, latitude] = geometry.coordinates as unknown[];
  if (!isFiniteNumber(longitude) || !isFiniteNumber(latitude) ||
    latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return { ok: false, rejection: { reason: "Invalid coordinates.", textId, name } };
  }

  const eleRaw = properties.ele;
  let elevationMeters: number | undefined;
  if (eleRaw !== undefined && eleRaw !== null) {
    if (!isFiniteNumber(eleRaw) || eleRaw < -500 || eleRaw > 9000) {
      return { ok: false, rejection: { reason: "Invalid elevation.", textId, name } };
    }
    elevationMeters = eleRaw;
  }

  const collectible: Collectible = {
    id: passCollectibleId(textId),
    name,
    type: "mountain_pass",
    latitude,
    longitude,
    radiusMeters,
    value: mountainPassValueFromElevation(elevationMeters),
    rarity: "common",
    status: "published",
    primaryCategory: MOUNTAIN_PASS_CATEGORY,
    ...(elevationMeters === undefined ? {} : { elevationMeters }),
    source: {
      sourceType: QUAELDICH_SOURCE_TYPE,
      sourceExternalId: textId,
      sourceUrl: passDeeplink(textId),
      sourceAttribution: QUAELDICH_ATTRIBUTION
    }
  };
  return { ok: true, collectible };
};

export interface NormalizedBatch {
  collectibles: Collectible[];
  rejected: RejectedFeature[];
  fetchedCount: number;
}

/**
 * Validates the FeatureCollection envelope and normalizes every feature. Throws on a
 * structurally invalid payload so an unexpected upstream format fails safely rather
 * than importing nothing silently. Duplicate TextIDs keep the last occurrence and are
 * reported as rejections for the shadowed earlier ones.
 */
export const normalizeQuaeldichCollection = (
  payload: unknown,
  options: NormalizeOptions
): NormalizedBatch => {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("quäldich payload must be a GeoJSON object.");
  }
  const document = payload as Record<string, unknown>;
  if (document.type !== "FeatureCollection" || !Array.isArray(document.features)) {
    throw new Error("quäldich payload must be a GeoJSON FeatureCollection.");
  }
  const features = document.features;
  const rejected: RejectedFeature[] = [];
  const byId = new Map<string, Collectible>();
  for (const feature of features) {
    const result = normalizeQuaeldichFeature(feature, options);
    if (!result.ok) {
      rejected.push(result.rejection);
      continue;
    }
    const existing = byId.get(result.collectible.id);
    if (existing) {
      rejected.push({
        reason: "Duplicate TextID (superseded by later feature).",
        textId: existing.source?.sourceExternalId,
        name: existing.name
      });
    }
    byId.set(result.collectible.id, result.collectible);
  }
  return { collectibles: [...byId.values()], rejected, fetchedCount: features.length };
};
