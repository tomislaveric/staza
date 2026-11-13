import { describe, expect, it, vi } from "vitest";
import { STAZA_DARK_PALETTE } from "./basemapTheme.js";
import { THEMED_STYLE_PATH, createThemedStyleLoader, getBasemapConfig } from "./basemap.js";

const PROVIDER_URL = "https://tiles.example/styles/liberty";

const providerStyle = () => ({
  version: 8,
  sprite: "../sprites/liberty",
  glyphs: "https://tiles.example/fonts/{fontstack}/{range}.pbf",
  sources: { openmaptiles: { type: "vector", url: "/planet" } },
  layers: [{ id: "background", type: "background", paint: { "background-color": "#f8f4f0" } }]
});

const okFetch = () => vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => providerStyle() });

describe("getBasemapConfig", () => {
  it("points clients at the Staza-themed style on the requesting origin", () => {
    expect(getBasemapConfig("https://staza.example").styleUrl).toBe(`https://staza.example${THEMED_STYLE_PATH}`);
  });
});

describe("createThemedStyleLoader", () => {
  it("themes the provider style and keeps its resources reachable", async () => {
    const loader = createThemedStyleLoader({ providerStyleUrl: PROVIDER_URL, fetchImpl: okFetch() });

    const style = await loader.getStyle();

    expect(style.layers[0].paint?.["background-color"]).toBe(STAZA_DARK_PALETTE.background);
    expect(style.sprite).toBe("https://tiles.example/sprites/liberty");
    expect(style.glyphs).toBe("https://tiles.example/fonts/{fontstack}/{range}.pbf");
    expect((style.sources as Record<string, { url: string }>).openmaptiles.url).toBe("https://tiles.example/planet");
  });

  it("serves the cached style until it expires", async () => {
    let time = 0;
    const fetchImpl = okFetch();
    const loader = createThemedStyleLoader({ providerStyleUrl: PROVIDER_URL, fetchImpl, ttlMs: 100, now: () => time });

    await loader.getStyle();
    await loader.getStyle();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    time = 101;
    await loader.getStyle();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not cache provider failures", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => providerStyle() });
    const loader = createThemedStyleLoader({ providerStyleUrl: PROVIDER_URL, fetchImpl });

    await expect(loader.getStyle()).rejects.toThrow(/503/);
    await expect(loader.getStyle()).resolves.toMatchObject({ version: 8 });
  });
});
