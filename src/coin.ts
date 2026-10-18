import { readFile } from "node:fs/promises";
import type { Collectible, CollectibleType } from "./domain.js";
import { UserInputError } from "./errors.js";

export const normalizeCollectibles = (parsed: unknown): Collectible[] => {
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new UserInputError("Collectible configuration must be a nonempty list.");
  }
  const collectibles = parsed.map(normalizeCollectible);
  const ids = new Set(collectibles.map((collectible) => collectible.id));
  if (ids.size !== collectibles.length) {
    throw new UserInputError("Collectible configuration contains duplicate ids.");
  }
  return collectibles;
};

export const readCollectibles = async (file: string): Promise<Collectible[]> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UserInputError(`Collectible configuration could not be read: ${message}`);
  }
  return normalizeCollectibles(parsed);
};

const types: readonly CollectibleType[] = ["coin", "landmark", "mountain_pass"];
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const normalizeCollectible = (value: unknown, index: number): Collectible => {
  const label = `Collectible at index ${index}`;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UserInputError(`${label} must be an object.`);
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || candidate.id.trim() === "") {
    throw new UserInputError(`${label} must have a nonblank id.`);
  }
  if (!isFiniteNumber(candidate.latitude) || candidate.latitude < -90 || candidate.latitude > 90 ||
    !isFiniteNumber(candidate.longitude) || candidate.longitude < -180 || candidate.longitude > 180) {
    throw new UserInputError(`${label} must have valid finite latitude and longitude.`);
  }
  if (!isFiniteNumber(candidate.radius_m) || candidate.radius_m <= 0) {
    throw new UserInputError(`${label} radius_m must be a positive finite number.`);
  }
  if (!isFiniteNumber(candidate.value) || candidate.value < 0) {
    throw new UserInputError(`${label} value must be a nonnegative finite number.`);
  }
  const name = candidate.name ?? candidate.id;
  if (typeof name !== "string" || name.trim() === "") {
    throw new UserInputError(`${label} name must be a nonblank string.`);
  }
  const type = candidate.type ?? "coin";
  if (typeof type !== "string" || !types.includes(type as CollectibleType)) {
    throw new UserInputError(`${label} type must be one of: ${types.join(", ")}.`);
  }
  if (candidate.description !== undefined &&
    (typeof candidate.description !== "string" || candidate.description.trim() === "")) {
    throw new UserInputError(`${label} description must be a nonblank string when provided.`);
  }
  return {
    id: candidate.id,
    name,
    type: type as CollectibleType,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    radiusMeters: candidate.radius_m,
    value: candidate.value,
    ...(candidate.description === undefined ? {} : { description: candidate.description })
  };
};
