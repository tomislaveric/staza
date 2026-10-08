import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { filteredWorldCollectibles, filteredWorldFartleks, mappedWorldCollectibles, mountWorldPage, visibleWorldCollectibles, WorldFilterControls, worldFilters, WorldPage } from "./world-page.js";
import { CollectibleSwatch } from "./world/collectible-swatch.js";
import * as worldMarkers from "./world/world-markers.js";
import * as worldMap from "./world/world-map.js";

const collectibles = [
  { id: "common-found", name: "Common", type: "landmark", primaryCategory: "viewpoint", found: true, rarity: "common", latitude: 49, longitude: 8 },
  { id: "rare-unfound", name: "Rare", type: "landmark", primaryCategory: "peak", found: false, rarity: "rare", latitude: 50, longitude: 9 },
  { id: "epic-found", name: "Epic", type: "landmark", primaryCategory: "castle", found: true, rarity: "epic", latitude: 51, longitude: 10 }
];

const fartleks = [
  { id: "fartlek-1", name: "Harbour Straight", completed: false, geometry: { type: "LineString", coordinates: [[8, 49], [8.01, 49.01]] }, lengthMeters: 1000 },
  { id: "fartlek-2", name: "River Run", completed: true, geometry: { type: "LineString", coordinates: [[9, 50], [9.01, 50.01]] }, lengthMeters: 1000 }
];

describe("World page data transformations", () => {
  it("keeps rarity filters independent from player discovery state", () => {
    expect(filteredWorldCollectibles(collectibles, ["found"]).map((item) => item.id)).toEqual(["common-found", "epic-found"]);
    expect(filteredWorldCollectibles(collectibles, ["unfound"]).map((item) => item.id)).toEqual(["rare-unfound"]);
    expect(filteredWorldCollectibles(collectibles, ["rare"]).map((item) => item.id)).toEqual(["rare-unfound"]);
    expect(filteredWorldCollectibles(collectibles, ["epic"]).map((item) => item.id)).toEqual(["epic-found"]);
  });

  it("keeps future hidden markers out of all filter states without changing discovery filters", () => {
    const hidden = {
      id: "epic-hidden",
      found: false,
      rarity: "epic",
      latitude: 52,
      longitude: 11,
      visibility: "hidden"
    };
    const withHidden = [...collectibles, hidden];

    expect(visibleWorldCollectibles(withHidden).map((item) => item.id)).toEqual([
      "common-found", "rare-unfound", "epic-found"
    ]);
    for (const filters of [[], ["epic"], ["unfound", "epic"], ["fartleks", "epic"]]) {
      expect(filteredWorldCollectibles(withHidden, filters)).not.toContain(hidden);
    }
  });

  it("shows the union of discovery, rarity, and category matches without duplicates", () => {
    expect(filteredWorldCollectibles(collectibles, ["found", "rare"]).map((item) => item.id))
      .toEqual(["common-found", "rare-unfound", "epic-found"]);
    expect(filteredWorldCollectibles(collectibles, ["unfound", "castle", "epic"]).map((item) => item.id))
      .toEqual(["rare-unfound", "epic-found"]);
    expect(filteredWorldCollectibles(collectibles, ["found", "unfound"])).toEqual(collectibles);
    expect(filteredWorldCollectibles(collectibles, ["rare", "epic"]).map((item) => item.id))
      .toEqual(["rare-unfound", "epic-found"]);
  });

  it.each(["viewpoint", "peak", "castle", "waterfall", "place"])("matches the map category for %s", (category) => {
    const primary = { ...collectibles[0], id: "primary", primaryCategory: category };
    const legacy = { ...collectibles[0], id: "legacy", primaryCategory: undefined, type: category };
    const overridden = { ...collectibles[0], id: "overridden", primaryCategory: "coin", type: category };

    expect(filteredWorldCollectibles([primary, legacy, overridden], [category])).toEqual([primary, legacy]);
  });

  it("shows every visible collectible when the selection is empty", () => {
    expect(filteredWorldCollectibles(collectibles, [])).toEqual(collectibles);
  });
});

describe("Fartlek filtering", () => {
  it("exposes a Fartleks control alongside the collectible filters", () => {
    expect(worldFilters).toContain("fartleks");
  });

  it("hides collectibles entirely under the Fartleks filter", () => {
    expect(filteredWorldCollectibles(collectibles, ["fartleks"])).toEqual([]);
  });

  it("hides Fartleks under collectible-only filters, leaving them visible otherwise", () => {
    for (const filter of worldFilters.filter((filter) => filter !== "all" && filter !== "fartleks")) {
      expect(filteredWorldFartleks(fartleks, [filter])).toEqual([]);
    }
    expect(filteredWorldFartleks(fartleks, ["found", "castle"])).toEqual([]);
    expect(filteredWorldFartleks(fartleks, [])).toEqual(fartleks);
    expect(filteredWorldFartleks(fartleks, ["fartleks"])).toEqual(fartleks);
  });

  it("combines both Fartlek completion states with matching collectibles", () => {
    expect(filteredWorldFartleks(fartleks, ["fartleks", "unfound", "castle"])).toEqual(fartleks);
    expect(filteredWorldCollectibles(collectibles, ["fartleks", "unfound", "castle"]).map((item) => item.id))
      .toEqual(["rare-unfound", "epic-found"]);
  });
});

describe("World map rendering is MapLibre native", () => {
  it("no longer exposes DOM collectible marker machinery", () => {
    expect(worldMarkers.createMarkerElement).toBeUndefined();
    expect(worldMarkers.markerClassName).toBeUndefined();
    expect(worldMarkers.markerInnerHtml).toBeUndefined();
    expect(worldMap.createWorldMap).toBeTypeOf("function");
  });

  it("hidden collectibles never reach the map source", () => {
    const hidden = { id: "hidden", found: false, rarity: "epic", latitude: 52, longitude: 11, visibility: "hidden" };

    expect(mappedWorldCollectibles([...collectibles, hidden], []).map((item) => item.id))
      .toEqual(["common-found", "rare-unfound", "epic-found"]);
  });
});

describe("World filter controls", () => {
  const buttonMarkup = (markup, filter) =>
    markup.match(new RegExp(`<button[^>]*data-world-filter="${filter}"[^>]*>[\\s\\S]*?</button>`))[0];

  it("renders labelled toggle buttons rather than single-select tabs", () => {
    const markup = WorldFilterControls(["rare", "castle"]);
    expect(worldFilters).toEqual(["all", "found", "unfound", "rare", "epic", "fartleks", "viewpoint", "peak", "castle", "waterfall", "place"]);
    expect(markup).toContain('role="group" aria-label="World collectibles"');
    expect(markup).not.toContain('role="tab');
    expect(markup).not.toContain("aria-selected");
    for (const filter of worldFilters) {
      expect(buttonMarkup(markup, filter)).toContain(`aria-pressed="${filter === "rare" || filter === "castle"}"`);
      expect(buttonMarkup(markup, filter)).toContain('type="button"');
    }
  });

  it("marks only All as active when no filters are selected", () => {
    const markup = WorldFilterControls([]);
    expect(buttonMarkup(markup, "all")).toContain('aria-pressed="true"');
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it("reuses the marker swatches for discovery, rarity, categories, and Fartleks", () => {
    const markup = WorldFilterControls([]);
    expect(buttonMarkup(markup, "found")).toContain(CollectibleSwatch({ visited: true }));
    expect(buttonMarkup(markup, "unfound")).toContain(CollectibleSwatch({ visited: false }));
    for (const rarity of ["rare", "epic"]) {
      expect(buttonMarkup(markup, rarity)).toContain(CollectibleSwatch({ rarity }));
    }
    for (const category of ["viewpoint", "peak", "castle", "waterfall", "place"]) {
      expect(buttonMarkup(markup, category)).toContain(CollectibleSwatch({ category }));
    }
    expect(buttonMarkup(markup, "fartleks")).toContain('<b class="fartlek-swatch" aria-hidden="true"></b>');
    expect(markup).not.toContain("is-completed");
  });

  it("renders one filter group without a map-overlay legend", () => {
    const markup = WorldPage({ lifetime: { discoveredCount: 1, totalCollectibles: 3 }, selectedFilters: [] });
    expect(markup.match(/class="world-filter-controls"/g)).toHaveLength(1);
    expect(markup).not.toContain("world-legend");
    expect(markup).not.toContain("World marker legend");
    expect(worldMarkers.WorldLegend).toBeUndefined();
  });

  it("wraps controls and retains focus styling and mobile touch targets", () => {
    const css = readFileSync(new URL("../styles/world.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.world-filter-controls\s*\{[^}]*flex-wrap:\s*wrap/s);
    expect(css).toContain(".world-filter-controls button:focus-visible");
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*\.world-filter-controls button\s*\{[^}]*min-height:\s*38px/s);
    expect(css).not.toContain(".world-legend");
  });
});

describe("mounted World page interactions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const mount = async ({ isOwner = false } = {}) => {
    const element = () => ({
      innerHTML: "",
      hidden: false,
      textContent: "",
      handlers: {},
      attributes: {},
      classList: { toggle: vi.fn() },
      addEventListener(event, handler) { this.handlers[event] = handler; },
      setAttribute(name, value) { this.attributes[name] = value; },
      querySelector: () => undefined,
      querySelectorAll: () => []
    });
    const buttons = Object.fromEntries(worldFilters.map((filter) => [
      filter, { ...element(), dataset: { worldFilter: filter } }
    ]));
    const hosts = Object.fromEntries([
      "map", "status", "stats", "quests", "detail", "collectible-list", "editor", "locate"
    ].map((name) => [`[data-world-${name}]`, element()]));
    const questButton = { ...element(), dataset: { questCard: "quest-1" } };
    const deleteButton = element();
    const ownerButtons = [element(), element(), deleteButton];
    const detail = hosts["[data-world-detail]"];
    detail.querySelector = (selector) =>
      selector === "[data-quest-delete]" && detail.innerHTML.includes("data-quest-delete") ? deleteButton : undefined;
    detail.querySelectorAll = (selector) =>
      selector === ".quest-detail-owner-actions button" && detail.innerHTML.includes("data-quest-delete") ? ownerButtons : [];
    hosts["[data-world-quests]"].querySelectorAll = () => [questButton];
    const mountPoint = {
      innerHTML: "",
      querySelector: (selector) => hosts[selector],
      querySelectorAll: () => Object.values(buttons)
    };
    const stats = { totalCollectibles: 3, discoveredCount: 2, rareFinds: 0, epicFinds: 1, remainingCount: 1 };
    const questCollectible = { ...collectibles[0], id: "quest-only", name: "Quest viewpoint" };
    const quest = {
      id: "quest-1", title: "Viewpoint quest", status: "published", createdBy: "Ada", isOwner,
      collectibleCount: 2, hasRoute: false,
      progress: { collected: 2, total: 2, ratio: 1, complete: true },
      collectibles: [questCollectible, collectibles[0]]
    };
    let deleted = false;
    const fetchMock = vi.fn(async (url, options) => {
      let body;
      if (url === "/api/world/basemap") body = { styleUrl: "/style.json" };
      else if (url === "/api/world") body = { stats };
      else if (url.startsWith("/api/world?bbox=")) body = { collectibles, fartleks, quests: deleted ? [] : [quest], stats, truncated: false };
      else if (url === "/api/quests/quest-1" && options?.method === "DELETE") {
        deleted = true;
        return { ok: true, status: 204 };
      }
      else if (url === "/api/quests/quest-1") body = quest;
      else throw new Error(`Unexpected fetch: ${url}`);
      return { ok: true, json: async () => body };
    });
    vi.stubGlobal("fetch", fetchMock);
    const map = {
      getBounds: () => ({ west: 8, south: 49, east: 11, north: 52 }),
      setCollectibles: vi.fn(), setFartleks: vi.fn(), setDetailPanelOpen: vi.fn(),
      setRoute: vi.fn(), fitTo: vi.fn()
    };
    const createMap = vi.spyOn(worldMap, "createWorldMap").mockResolvedValue(map);
    await mountWorldPage(mountPoint);
    return {
      click: (filter) => buttons[filter].handlers.click(),
      buttons, map, fetchMock, questButton, deleteButton, ownerButtons,
      callbacks: createMap.mock.calls[0][1],
      detail,
      status: hosts["[data-world-status]"],
      quests: hosts["[data-world-quests]"],
      collectibleIds: () => map.setCollectibles.mock.lastCall[0].features.map((feature) => feature.id),
      fartlekIds: () => map.setFartleks.mock.lastCall[0].features.map((feature) => feature.id)
    };
  };

  it("toggles a union, removes individual filters, and resets without refetching", async () => {
    const page = await mount();
    page.click("rare");
    expect(page.collectibleIds()).toEqual(["rare-unfound"]);
    expect(page.fartlekIds()).toEqual([]);
    page.click("found");
    expect(page.collectibleIds()).toEqual(collectibles.map((item) => item.id));
    expect(page.buttons.rare.attributes["aria-pressed"]).toBe("true");
    expect(page.buttons.found.attributes["aria-pressed"]).toBe("true");
    expect(page.buttons.all.attributes["aria-pressed"]).toBe("false");
    page.click("fartleks");
    expect(page.fartlekIds()).toEqual(fartleks.map((item) => item.id));
    page.click("found");
    expect(page.collectibleIds()).toEqual(["rare-unfound"]);
    page.click("all");
    expect(page.collectibleIds()).toEqual(collectibles.map((item) => item.id));
    expect(page.fartlekIds()).toEqual(fartleks.map((item) => item.id));
    for (const filter of worldFilters) {
      expect(page.buttons[filter].attributes["aria-pressed"]).toBe(String(filter === "all"));
    }
    page.click("castle");
    page.click("castle");
    expect(page.buttons.all.attributes["aria-pressed"]).toBe("true");
    expect(page.collectibleIds()).toEqual(collectibles.map((item) => item.id));
    expect(page.fartlekIds()).toEqual(fartleks.map((item) => item.id));
    expect(page.fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retains matching collectible details and clears selections excluded by the union", async () => {
    const page = await mount();
    page.callbacks.onCollectibleSelect("epic-found");
    expect(page.detail.hidden).toBe(false);
    page.click("found");
    page.click("rare");
    expect(page.detail.innerHTML).toContain("Epic");
    expect(page.map.setCollectibles.mock.lastCall[0].features.find((feature) => feature.id === "epic-found").properties.selected).toBe(true);
    page.click("found");
    expect(page.detail.hidden).toBe(true);
    expect(page.detail.innerHTML).toBe("");
    page.click("fartleks");
    page.callbacks.onFartlekSelect("fartlek-1");
    expect(page.detail.innerHTML).toContain("Harbour Straight");
    page.click("rare");
    expect(page.detail.hidden).toBe(false);
    page.click("fartleks");
    expect(page.detail.hidden).toBe(false);
    page.click("castle");
    expect(page.detail.hidden).toBe(true);
  });

  it("keeps active quest collectibles mapped and deduplicated across filter changes", async () => {
    const page = await mount();
    page.questButton.handlers.click();
    await vi.waitFor(() => expect(page.detail.innerHTML).toContain("Viewpoint quest"));
    page.click("fartleks");
    expect(page.collectibleIds()).toEqual(["quest-only", "common-found"]);
    expect(page.detail.hidden).toBe(false);
    page.click("found");
    expect(page.collectibleIds()).toEqual(["common-found", "epic-found", "quest-only"]);
    expect(page.map.setCollectibles.mock.lastCall[0].features.map((feature) => feature.properties.questRelated))
      .toEqual([true, false, true]);
    expect(page.map.fitTo).toHaveBeenCalledOnce();
  });

  it("confirms owner deletion, clears the route and detail, and refreshes nearby quests", async () => {
    vi.stubGlobal("window", { confirm: vi.fn(() => true) });
    const page = await mount({ isOwner: true });
    page.questButton.handlers.click();
    await vi.waitFor(() => expect(page.detail.innerHTML).toContain("data-quest-delete"));
    expect(page.collectibleIds()).toContain("quest-only");
    page.deleteButton.handlers.click();
    expect(page.ownerButtons.every((button) => button.disabled)).toBe(true);
    page.deleteButton.handlers.click();
    await vi.waitFor(() => expect(page.quests.innerHTML).not.toContain("Viewpoint quest"));
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(page.fetchMock.mock.calls.filter(([, options]) => options?.method === "DELETE"))
      .toEqual([["/api/quests/quest-1", { method: "DELETE" }]]);
    expect(page.detail.hidden).toBe(true);
    expect(page.map.setRoute).toHaveBeenLastCalledWith(undefined);
    expect(page.collectibleIds()).not.toContain("quest-only");
    expect(page.fetchMock.mock.calls.filter(([url]) => url.startsWith("/api/world?bbox="))).toHaveLength(2);
  });

  it("leaves the quest intact when deletion is cancelled", async () => {
    vi.stubGlobal("window", { confirm: vi.fn(() => false) });
    const page = await mount({ isOwner: true });
    page.questButton.handlers.click();
    await vi.waitFor(() => expect(page.detail.innerHTML).toContain("data-quest-delete"));
    page.deleteButton.handlers.click();
    expect(page.fetchMock.mock.calls.some(([, options]) => options?.method === "DELETE")).toBe(false);
    expect(page.detail.hidden).toBe(false);
    expect(page.quests.innerHTML).toContain("Viewpoint quest");
    expect(page.ownerButtons.every((button) => !button.disabled)).toBe(true);
  });

  it("shows delete failures without removing the quest and re-enables owner actions", async () => {
    vi.stubGlobal("window", { confirm: vi.fn(() => true) });
    const page = await mount({ isOwner: true });
    page.questButton.handlers.click();
    await vi.waitFor(() => expect(page.detail.innerHTML).toContain("data-quest-delete"));
    page.fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: "Unable to delete this quest." }) });
    page.deleteButton.handlers.click();
    await vi.waitFor(() => expect(page.status.textContent).toBe("Unable to delete this quest."));
    expect(page.status.hidden).toBe(false);
    expect(page.detail.hidden).toBe(false);
    expect(page.quests.innerHTML).toContain("Viewpoint quest");
    expect(page.collectibleIds()).toContain("quest-only");
    expect(page.ownerButtons.every((button) => !button.disabled)).toBe(true);
  });

  it("does not expose deletion for another user's published quest", async () => {
    const page = await mount();
    page.questButton.handlers.click();
    await vi.waitFor(() => expect(page.detail.innerHTML).toContain("Viewpoint quest"));
    expect(page.detail.innerHTML).not.toContain("data-quest-delete");
    expect(page.deleteButton.handlers.click).toBeUndefined();
  });
});
