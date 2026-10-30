import { readFile } from "node:fs/promises";
import { config } from "../config.js";

export const readQuaeldichGeoJsonFile = async (file: string | URL): Promise<unknown> =>
  JSON.parse(await readFile(file, "utf8")) as unknown;

/**
 * Downloads the official quäldich Pässelexikon GeoJSON. Kept isolated from
 * normalization and persistence so those can be tested without network access. Staza
 * never calls this while serving World requests — it is import-time only.
 */
export const fetchQuaeldichGeoJson = async (url: string = config.quaeldichGeoJsonUrl): Promise<unknown> => {
  const response = await fetch(url, { headers: { accept: "application/geo+json, application/json" } });
  if (!response.ok) {
    throw new Error(`quäldich source responded with HTTP ${response.status}.`);
  }
  return response.json();
};
