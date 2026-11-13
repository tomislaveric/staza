import { config } from "./config.js";
import { applyStazaMapTheme, type MapStyle } from "./basemapTheme.js";

export interface BasemapConfig {
  styleUrl: string;
  attribution: string;
}

/** Path of the Staza-themed basemap style document served to every client. */
export const THEMED_STYLE_PATH = "/api/world/basemap/style.json";

/**
 * Boundary for the basemap tile provider. World logic never names a provider, so the
 * tile source can be replaced through configuration alone. Clients receive the themed
 * style served by Staza, never the raw provider style.
 */
export const getBasemapConfig = (origin: string): BasemapConfig => ({
  styleUrl: new URL(THEMED_STYLE_PATH, origin).toString(),
  attribution: config.basemapAttribution
});

/** Origins the browser must be allowed to reach to load the configured basemap. */
export const getBasemapOrigins = (): string[] => {
  const origins = new Set<string>(config.basemapExtraOrigins);
  try {
    origins.add(new URL(config.basemapStyleUrl).origin);
  } catch {
    return [...origins];
  }
  return [...origins];
};

const resolveAgainst = (value: unknown, base: string): unknown => {
  if (typeof value !== "string") return value;
  try {
    // Keeps MapLibre placeholders such as {fontstack} readable after URL resolution.
    return decodeURI(new URL(value, base).toString());
  } catch {
    return value;
  }
};

/** Makes provider-relative sprite, glyph and source URLs absolute so the style can be re-hosted. */
export const absolutizeStyleUrls = (style: MapStyle, providerStyleUrl: string): MapStyle => {
  const sources = (style.sources ?? {}) as Record<string, Record<string, unknown>>;
  return {
    ...style,
    ...(style.sprite !== undefined && {
      sprite: Array.isArray(style.sprite)
        ? style.sprite.map((entry: { url?: unknown }) => ({ ...entry, url: resolveAgainst(entry.url, providerStyleUrl) }))
        : resolveAgainst(style.sprite, providerStyleUrl)
    }),
    ...(style.glyphs !== undefined && { glyphs: resolveAgainst(style.glyphs, providerStyleUrl) }),
    sources: Object.fromEntries(Object.entries(sources).map(([id, source]) => [id, {
      ...source,
      ...(source.url !== undefined && { url: resolveAgainst(source.url, providerStyleUrl) }),
      ...(Array.isArray(source.tiles) && { tiles: source.tiles.map((tile) => resolveAgainst(tile, providerStyleUrl)) })
    }]))
  };
};

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Loads the provider style once, themes it for Staza and caches the result. A failed
 * fetch is not cached so the next request retries the provider.
 */
export const createThemedStyleLoader = ({
  providerStyleUrl = config.basemapStyleUrl,
  ttlMs = 60 * 60 * 1000,
  fetchImpl = fetch as FetchLike,
  now = Date.now
}: {
  providerStyleUrl?: string;
  ttlMs?: number;
  fetchImpl?: FetchLike;
  now?: () => number;
} = {}) => {
  let cached: { style: MapStyle; expiresAt: number } | undefined;
  let pending: Promise<MapStyle> | undefined;

  const load = async (): Promise<MapStyle> => {
    const response = await fetchImpl(providerStyleUrl);
    if (!response.ok) throw new Error(`Basemap style request failed with ${response.status}.`);
    const style = absolutizeStyleUrls(applyStazaMapTheme(await response.json()), providerStyleUrl);
    cached = { style, expiresAt: now() + ttlMs };
    return style;
  };

  return {
    providerStyleUrl,
    async getStyle(): Promise<MapStyle> {
      if (cached && cached.expiresAt > now()) return cached.style;
      pending ??= load().finally(() => {
        pending = undefined;
      });
      return pending;
    }
  };
};
