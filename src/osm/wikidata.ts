import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OSMCandidate } from "./model.js";
import type { OSMProgressListener } from "./progress.js";

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const BATCH_SIZE = 50;
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_BATCH_DELAY_MS = 5_000;
const DEFAULT_MAX_ATTEMPTS = 5;
const MAX_BACKOFF_MS = 30_000;
const MAX_RETRY_AFTER_MS = 60_000;

interface CacheEntry {
  qid: string;
  fetchedAt: string;
  status: number;
  responseDate?: string;
  entity: Record<string, unknown>;
}

export interface WikidataLookup {
  qid: string;
  entity?: Record<string, unknown>;
  fetchedAt?: string;
  cacheHit?: boolean;
  error?: string;
  stale?: boolean;
  attempts?: number;
}

export interface WikidataClientOptions {
  cacheDirectory: string;
  fetcher?: typeof fetch;
  now?: () => Date;
  maxAgeMs?: number;
  batchDelayMs?: number;
  sleeper?: (milliseconds: number) => Promise<void>;
  maxAttempts?: number;
  random?: () => number;
  onProgress?: OSMProgressListener;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const entityLabel = (entity: Record<string, unknown> | undefined): string | undefined => {
  const labels = asRecord(entity?.labels);
  for (const language of ["de", "en"]) {
    const label = asRecord(labels?.[language])?.value;
    if (typeof label === "string" && label.trim()) return label.trim();
  }
  return undefined;
};

const entityDescription = (entity: Record<string, unknown> | undefined): string | undefined => {
  const descriptions = asRecord(entity?.descriptions);
  for (const language of ["de", "en"]) {
    const description = asRecord(descriptions?.[language])?.value;
    if (typeof description === "string" && description.trim()) return description.trim();
  }
  return undefined;
};

const sitelinkMatch = (
  wikipedia: string | undefined,
  entity: Record<string, unknown> | undefined
): boolean => {
  if (!wikipedia) return false;
  const colon = wikipedia.indexOf(":");
  if (colon < 1) return false;
  const language = wikipedia.slice(0, colon).toLowerCase();
  const title = wikipedia.slice(colon + 1).replaceAll("_", " ").trim();
  if (!/^[a-z-]+$/i.test(language) || !title) return false;
  const sitelinks = asRecord(entity?.sitelinks);
  const sitelink = asRecord(sitelinks?.[`${language}wiki`]);
  return typeof sitelink?.title === "string" && sitelink.title.replaceAll("_", " ") === title;
};

const coordinateFromEntity = (
  entity: Record<string, unknown> | undefined
): { latitude: number; longitude: number } | undefined => {
  const claims = asRecord(entity?.claims);
  const statements = claims?.P625;
  if (!Array.isArray(statements) || statements.length === 0) return undefined;
  const mainsnak = asRecord(asRecord(statements[0])?.mainsnak);
  const value = asRecord(asRecord(mainsnak?.datavalue)?.value);
  const latitude = value?.latitude;
  const longitude = value?.longitude;
  if (typeof latitude !== "number" || !Number.isFinite(latitude) ||
    typeof longitude !== "number" || !Number.isFinite(longitude) ||
    latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return undefined;
  return { latitude, longitude };
};

const instanceOf = (entity: Record<string, unknown> | undefined): Set<string> => {
  const claims = asRecord(entity?.claims);
  const statements = claims?.P31;
  if (!Array.isArray(statements)) return new Set();
  const ids = statements.map((statement) => {
    const mainsnak = asRecord(asRecord(statement)?.mainsnak);
    const value = asRecord(asRecord(mainsnak?.datavalue)?.value);
    return value?.id;
  });
  return new Set(ids.filter((id): id is string => typeof id === "string"));
};

const incompatibleTypes: Record<string, Set<string>> = {
  castle: new Set(["Q8502", "Q34038"]),
  peak: new Set(["Q23413", "Q34038"]),
  waterfall: new Set(["Q23413", "Q8502"]),
  viewpoint: new Set(["Q23413", "Q8502", "Q34038"]),
  place: new Set(["Q23413", "Q8502", "Q34038"])
};

const haversineMeters = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number => {
  const radians = Math.PI / 180;
  const latitudeGap = (b.latitude - a.latitude) * radians;
  const longitudeGap = (b.longitude - a.longitude) * radians;
  const term = Math.sin(latitudeGap / 2) ** 2 +
    Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(longitudeGap / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(term), Math.sqrt(1 - term));
};

class WikidataRequestError extends Error {
  constructor(message: string, readonly attempts: number) {
    super(message);
  }
}

const retryAfterMilliseconds = (value: string | null, now: Date): number | undefined => {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.min(Math.max(0, date - now.getTime()), MAX_RETRY_AFTER_MS);
};

export class WikidataClient {
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private readonly maxAgeMs: number;
  private readonly batchDelayMs: number;
  private readonly sleeper: (milliseconds: number) => Promise<void>;
  private readonly maxAttempts: number;
  private readonly random: () => number;
  private readonly onProgress: OSMProgressListener;

  constructor(private readonly options: WikidataClientOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.maxAgeMs = options.maxAgeMs ?? CACHE_MAX_AGE_MS;
    this.batchDelayMs = options.batchDelayMs ?? DEFAULT_BATCH_DELAY_MS;
    if (!Number.isFinite(this.batchDelayMs) || this.batchDelayMs < 0) {
      throw new Error("Wikidata batch delay must be a non-negative number.");
    }
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    if (!Number.isFinite(this.maxAttempts) || this.maxAttempts < 1) {
      throw new Error("Wikidata max attempts must be at least 1.");
    }
    this.random = options.random ?? Math.random;
    this.sleeper = options.sleeper ?? ((milliseconds) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    this.onProgress = options.onProgress ?? (() => undefined);
  }

  private cachePath(qid: string): string {
    return path.join(this.options.cacheDirectory, `${qid}.json`);
  }

  private async readCache(qid: string): Promise<CacheEntry | undefined> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.cachePath(qid), "utf8"));
      const entry = asRecord(parsed);
      if (entry?.qid !== qid || typeof entry.fetchedAt !== "string" ||
        typeof entry.status !== "number" || !asRecord(entry.entity)) return undefined;
      return entry as unknown as CacheEntry;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  private async writeCache(entry: CacheEntry): Promise<void> {
    await mkdir(this.options.cacheDirectory, { recursive: true });
    const file = this.cachePath(entry.qid);
    const temporary = `${file}.tmp`;
    await writeFile(temporary, `${JSON.stringify(entry, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, file);
  }

  async lookup(qids: string[], { forceRefresh = false }: { forceRefresh?: boolean } = {}): Promise<Map<string, WikidataLookup>> {
    const unique = [...new Set(qids)].filter((qid) => /^Q[1-9]\d*$/.test(qid)).sort();
    const output = new Map<string, WikidataLookup>();
    const misses: string[] = [];
    const stale = new Map<string, CacheEntry>();
    for (const qid of unique) {
      const cache = await this.readCache(qid);
      const age = cache ? this.now().getTime() - Date.parse(cache.fetchedAt) : Infinity;
      if (cache && !forceRefresh && Number.isFinite(age) && age >= 0 && age <= this.maxAgeMs) {
        output.set(qid, { qid, entity: cache.entity, fetchedAt: cache.fetchedAt, cacheHit: true });
      } else {
        misses.push(qid);
        if (cache) stale.set(qid, cache);
      }
    }

    const batchCount = Math.ceil(misses.length / BATCH_SIZE);
    this.onProgress({
      scope: "wikidata",
      message: `Resolving ${unique.length} QIDs: ${unique.length - misses.length} cached, ` +
        `${misses.length} to fetch in ${batchCount} batches`
    });

    for (let offset = 0; offset < misses.length; offset += BATCH_SIZE) {
      const label = `batch ${Math.floor(offset / BATCH_SIZE) + 1}/${batchCount}`;
      if (offset > 0 && this.batchDelayMs > 0) {
        this.onProgress({
          scope: "wikidata",
          message: `${label}: pacing, waiting ${this.batchDelayMs} ms before the next request`
        });
        await this.sleeper(this.batchDelayMs);
      }
      const batch = misses.slice(offset, offset + BATCH_SIZE);
      try {
        const batchResult = await this.fetchBatch(batch, label);
        this.onProgress({
          scope: "wikidata",
          message: `${label}: resolved ${batch.length} QIDs`
        });
        for (const qid of batch) {
          const entity = asRecord(batchResult.entities[qid]);
          if (!entity || typeof entity.id !== "string" || entity.id !== qid) {
            output.set(qid, {
              qid,
              error: "Wikidata returned no matching entity.",
              attempts: batchResult.attempts
            });
            continue;
          }
          const fetchedAt = this.now().toISOString();
          const entry: CacheEntry = {
            qid,
            fetchedAt,
            status: batchResult.status,
            ...(batchResult.responseDate ? { responseDate: batchResult.responseDate } : {}),
            entity
          };
          await this.writeCache(entry);
          output.set(qid, { qid, entity, fetchedAt, cacheHit: false, attempts: batchResult.attempts });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Wikidata request failed.";
        const attempts = error instanceof WikidataRequestError ? error.attempts : this.maxAttempts;
        this.onProgress({
          scope: "wikidata",
          message: `${label}: failed after ${attempts} attempts (${message})`
        });
        for (const qid of batch) {
          const cached = stale.get(qid);
          output.set(qid, cached
            ? {
                qid,
                entity: cached.entity,
                fetchedAt: cached.fetchedAt,
                cacheHit: true,
                stale: true,
                error: message,
                attempts
              }
            : { qid, error: message, attempts });
        }
      }
    }
    return output;
  }

  /**
   * Retries transient upstream failures with bounded exponential backoff and honors
   * `Retry-After`; non-transient client errors fail immediately.
   */
  private async fetchBatch(batch: string[], label: string): Promise<{
    entities: Record<string, unknown>;
    status: number;
    responseDate?: string;
    attempts: number;
  }> {
    const url = new URL(WIKIDATA_API);
    url.search = new URLSearchParams({
      action: "wbgetentities",
      ids: batch.join("|"),
      props: "labels|descriptions|claims|sitelinks",
      languages: "de|en",
      sitefilter: "dewiki|enwiki",
      format: "json",
      formatversion: "2"
    }).toString();
    let lastError = "Wikidata request failed.";
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      let retryDelay: number | undefined;
      this.onProgress({
        scope: "wikidata",
        message: `${label}: requesting ${batch.length} QIDs (attempt ${attempt}/${this.maxAttempts})`
      });
      try {
        const response = await this.fetcher(url, {
          headers: { "User-Agent": "StazaCollectibleImporter/1.0 (maintenance script)" },
          signal: AbortSignal.timeout(30_000)
        });
        if (!response.ok) {
          const transient = response.status === 429 || response.status >= 500;
          lastError = `Wikidata returned HTTP ${response.status}.`;
          if (!transient || attempt === this.maxAttempts) throw new WikidataRequestError(lastError, attempt);
          retryDelay = retryAfterMilliseconds(response.headers.get("retry-after"), this.now());
        } else {
          const payload: unknown = await response.json();
          const entities = asRecord(asRecord(payload)?.entities);
          if (!entities) throw new Error("Wikidata response did not contain an entities object.");
          const responseDate = response.headers.get("date");
          return {
            entities,
            status: response.status,
            ...(responseDate ? { responseDate } : {}),
            attempts: attempt
          };
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Wikidata request failed.";
        if (error instanceof WikidataRequestError || attempt === this.maxAttempts) {
          throw new WikidataRequestError(lastError, attempt);
        }
      }
      const exponential = Math.min(1_000 * (2 ** (attempt - 1)), MAX_BACKOFF_MS);
      const jitter = Math.floor(this.random() * 500);
      const waitMs = retryDelay ?? exponential + jitter;
      this.onProgress({
        scope: "wikidata",
        message: `${label}: attempt ${attempt} failed (${lastError}); retrying in ${waitMs} ms`
      });
      await this.sleeper(waitMs);
    }
    throw new WikidataRequestError(lastError, this.maxAttempts);
  }
}

export const enrichCandidates = async (
  candidates: OSMCandidate[],
  client: WikidataClient,
  options: { forceRefresh?: boolean } = {}
): Promise<{ candidates: OSMCandidate[]; directQidCount: number; resolvedQidCount: number; unmatchedQidCount: number }> => {
  const qids = candidates.flatMap((candidate) => candidate.wikidataQid ? [candidate.wikidataQid] : []);
  const lookup = await client.lookup(qids, options);
  let resolvedQidCount = 0;
  let unmatchedQidCount = 0;
  const enriched = candidates.map((candidate) => {
    const qid = candidate.wikidataQid;
    if (!qid) return candidate;
    const result = lookup.get(qid) ?? { qid, error: "No Wikidata response was produced." };
    if (!result.entity) {
      unmatchedQidCount += 1;
      return {
        ...candidate,
        wikidataCompatible: false,
        enrichmentMetadata: {
          qid,
          state: "unresolved",
          error: result.error ?? "Missing Wikidata entity.",
          ...(result.attempts === undefined ? {} : { attempts: result.attempts })
        }
      };
    }
    resolvedQidCount += 1;
    const label = entityLabel(result.entity);
    const reference = sitelinkMatch(candidate.wikipediaReference, result.entity);
    const qidTypes = instanceOf(result.entity);
    const typeCompatible = ![...qidTypes].some((id) => incompatibleTypes[candidate.primaryCategory].has(id));
    const wikidataCoordinates = coordinateFromEntity(result.entity);
    const coordinateCompatible = !wikidataCoordinates ||
      haversineMeters(candidate, wikidataCoordinates) <= 1_000;
    const wikipediaCompatible = !candidate.wikipediaReference || reference;
    return {
      ...candidate,
      ...(candidate.name === undefined && label ? { wikidataLabel: label } : {}),
      ...(label ? { wikidataEntityLabel: label } : {}),
      ...(entityDescription(result.entity) ? { wikidataDescription: entityDescription(result.entity) } : {}),
      ...(wikidataCoordinates ? { wikidataCoordinates } : {}),
      wikidataCompatible: typeCompatible && coordinateCompatible && wikipediaCompatible,
      wikipediaSitelinkMatched: reference,
      ...(reference ? { wikipediaReference: candidate.wikipediaReference } : {}),
      enrichmentMetadata: {
        qid,
        state: result.stale ? "stale-cache" : "resolved",
        fetchedAt: result.fetchedAt,
        ...(result.stale ? { refreshError: result.error, attempts: result.attempts } : {}),
        labelLanguage: entityLabel(result.entity) === asRecord(asRecord(result.entity.labels)?.de)?.value ? "de" : "en",
        wikipediaSitelinkMatched: reference,
        typeCompatible,
        coordinateCompatible,
        wikipediaCompatible
      }
    };
  });
  return { candidates: enriched, directQidCount: qids.length, resolvedQidCount, unmatchedQidCount };
};
