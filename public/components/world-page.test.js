import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { availableWorldFilters, filteredWorldCollectibles, filteredWorldFartleks, mappedWorldCollectibles, mountWorldPage, visibleWorldCollectibles, WorldFilterControls, worldFilters, WorldPage } from "./world-page.js";
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
  it("offers only matching filters while always retaining All", () => {
    expect([...availableWorldFilters([], [])]).toEqual(["all"]);
    expect([...availableWorldFilters(collectibles, [])]).toEqual([
      "all", "found", "unfound", "rare", "epic", "viewpoint", "peak", "castle"
    ]);
    expect([...availableWorldFilters([], fartleks)]).toEqual(["all", "fartleks"]);
    expect([...availableWorldFilters([{ ...collectibles[0], visibility: "hidden" }], [])]).toEqual(["all"]);
  });

  it("makes the mountain-pass filter available only when a visible pass exists", () => {
    const pass = { ...collectibles[0], id: "pass", primaryCategory: "mountain_pass" };
    expect(availableWorldFilters([pass], []).has("mountain_pass")).toBe(true);
    expect(availableWorldFilters([{ ...pass, visibility: "hidden" }], []).has("mountain_pass")).toBe(false);
  });

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

  it.each(["viewpoint", "peak", "castle", "waterfall", "place", "mountain_pass"])("matches the map category for %s", (category) => {
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
  it("labels the Fartleks control Flowlines alongside the collectible filters", () => {
    const controls = WorldFilterControls([], collectibles, fartleks);
    const flowlineButton = controls.match(/<button[^>]*data-world-filter="fartleks"[^>]*>[\s\S]*?<\/button>/)[0];

    expect(worldFilters).toContain("fartleks");
    expect(flowlineButton).toContain("Flowlines");
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
    const allCategories = [
      ...collectibles,
      { ...collectibles[0], id: "waterfall", primaryCategory: "waterfall" },
      { ...collectibles[0], id: "place", primaryCategory: "place" },
      { ...collectibles[0], id: "mountain-pass", primaryCategory: "mountain_pass" }
    ];
    const markup = WorldFilterControls(["rare", "castle"], allCategories, fartleks);
    expect(worldFilters).toEqual(["all", "found", "unfound", "rare", "epic", "fartleks", "viewpoint", "peak", "castle", "waterfall", "place", "mountain_pass"]);
    expect(markup).toContain('role="group" aria-label="World collectibles and Flowlines"');
    expect(markup).not.toContain('role="tab');
    expect(markup).not.toContain("aria-selected");
    for (const filter of worldFilters) {
      expect(buttonMarkup(markup, filter)).toContain(`aria-pressed="${filter === "rare" || filter === "castle"}"`);
      expect(buttonMarkup(markup, filter)).toContain('type="button"');
    }
  });

  it("marks only All as active when no filters are selected", () => {
    const markup = WorldFilterControls([], collectibles, fartleks);
    expect(buttonMarkup(markup, "all")).toContain('aria-pressed="true"');
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it("reuses the marker swatches for discovery, rarity, categories, and Fartleks", () => {
    const markup = WorldFilterControls([], [
      ...collectibles,
      { ...collectibles[0], id: "waterfall", primaryCategory: "waterfall" },
      { ...collectibles[0], id: "place", primaryCategory: "place" },
      { ...collectibles[0], id: "mountain-pass", primaryCategory: "mountain_pass" }
    ], fartleks);
    expect(buttonMarkup(markup, "found")).toContain(CollectibleSwatch({ visited: true }));
    expect(buttonMarkup(markup, "unfound")).toContain(CollectibleSwatch({ visited: false }));
    for (const rarity of ["rare", "epic"]) {
      expect(buttonMarkup(markup, rarity)).toContain(CollectibleSwatch({ rarity }));
    }
    for (const category of ["viewpoint", "peak", "castle", "waterfall", "place", "mountain_pass"]) {
      expect(buttonMarkup(markup, category)).toContain(CollectibleSwatch({ category }));
    }
    for (const [category, icon] of [
      ["castle", "\u26eb"],
      ["mountain_pass", "\u26f0"],
      ["peak", "\u25b2"],
      ["waterfall", "💦"]
    ]) {
      expect(CollectibleSwatch({ category })).toContain(icon);
      expect(CollectibleSwatch({ category })).toContain("is-icon");
      expect(CollectibleSwatch({ category, visited: true })).toContain("is-visited");
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
    expect(buttonMarkup(WorldFilterControls([]), "all")).not.toContain(" hidden");
  });

  it("hides filters without matching viewport items", () => {
    const markup = WorldFilterControls([], collectibles, []);
    expect(buttonMarkup(markup, "waterfall")).toContain(" hidden");
    expect(buttonMarkup(markup, "place")).toContain(" hidden");
    expect(buttonMarkup(markup, "castle")).not.toContain(" hidden");
  });

  it("wraps controls and retains focus styling and mobile touch targets", () => {
    const css = readFileSync(new URL("../styles/world.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.world-filter-controls\s*\{[^}]*flex-wrap:\s*wrap/s);
    expect(css).toContain(".world-filter-controls button[hidden] { display: none; }");
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

  const mount = async () => {
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
      "map", "status", "stats", "quests", "detail", "collectible-list", "locate"
    ].map((name) => [`[data-world-${name}]`, element()]));
    const questButton = { ...element(), dataset: { questStart: "suggestion-1" }, disabled: false };
    const questCancelButton = {
      ...element(),
      dataset: { questCancel: "instance-1" },
      disabled: false
    };
    const detail = hosts["[data-world-detail]"];
    hosts["[data-world-quests]"].querySelectorAll = (selector) => selector === "[data-quest-start]"
      ? [questButton]
      : selector === "[data-quest-cancel]" ? [questCancelButton] : [];
    const mountPoint = {
      innerHTML: "",
      querySelector: (selector) => hosts[selector],
      querySelectorAll: () => Object.values(buttons)
    };
    const stats = { totalCollectibles: 3, discoveredCount: 2, rareFinds: 0, epicFinds: 1, remainingCount: 1 };
    const questSuggestions = [{
      id: "suggestion-1",
      templateId: "first-steps",
      templateVersion: 1,
      title: "First Steps",
      description: "Complete a Flowline and discover a collectible.",
      recommendedLevel: 1,
      objectives: [
        { id: "flowline", type: "flowline_rule", requiredCount: 1, targets: [{ id: "fartlek-1", name: "Harbour Straight" }] },
        { id: "collectible", type: "collectible_targets", requiredCount: 1, targets: [{ id: "common-found", name: "Common" }] }
      ]
    }];
    let viewportSnapshot = { collectibles, fartleks, questSuggestions, stats, truncated: false };
    let activeInstances = [];
    const activeInstance = {
      id: "instance-1",
      suggestionId: "suggestion-1",
      templateId: "first-steps",
      templateVersion: 1,
      title: "First Steps",
      description: "Complete a Flowline and discover a collectible.",
      recommendedLevel: 1,
      status: "active",
      startedAt: "2026-04-01T10:00:00.000Z",
      objectives: [
        { objective: questSuggestions[0].objectives[0], progress: { completed: 0, required: 1, complete: false } },
        { objective: questSuggestions[0].objectives[1], progress: { completed: 0, required: 1, complete: false } }
      ]
    };
    const fetchMock = vi.fn(async (url, options) => {
      let body;
      if (url === "/api/world/basemap") body = { styleUrl: "/style.json" };
      else if (url === "/api/world") body = { stats };
      else if (url === "/api/quest-instances") body = { instances: activeInstances };
      else if (url === "/api/quest-instances/start" && options?.method === "POST") {
        activeInstances = [activeInstance];
        body = activeInstance;
      }
      else if (url === "/api/quest-instances/instance-1" && options?.method === "DELETE") {
        activeInstances = [];
      }
      else if (url.startsWith("/api/world?bbox=")) body = viewportSnapshot;
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
      buttons, map, fetchMock, questButton, questCancelButton,
      callbacks: createMap.mock.calls[0][1],
      detail,
      status: hosts["[data-world-status]"],
      changeViewport: (snapshot) => {
        viewportSnapshot = snapshot;
        createMap.mock.calls[0][1].onViewportChange(map.getBounds());
      },
      quests: hosts["[data-world-quests]"],
      collectibleIds: () => map.setCollectibles.mock.lastCall[0].features.map((feature) => feature.id),
      fartlekIds: () => map.setFartleks.mock.lastCall[0].features.map((feature) => feature.id)
    };
  };

  it("toggles a union, removes individual filters, and resets without refetching", async () => {
    const page = await mount();
    expect(page.quests.innerHTML).toContain("Suggested quests");
    expect(page.quests.innerHTML).toContain("First Steps");
    expect(page.quests.innerHTML).toContain("Start quest");
    expect(page.quests.innerHTML).not.toContain("0 / 2 objectives");
    expect(page.buttons.all.hidden).toBe(false);
    expect(page.buttons.waterfall.hidden).toBe(true);
    expect(page.buttons.place.hidden).toBe(true);
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
    expect(page.fetchMock).toHaveBeenCalledTimes(4);
  });

  it("updates available filters and clears selections when the viewport changes", async () => {
    const page = await mount();
    page.click("peak");
    expect(page.buttons.peak.attributes["aria-pressed"]).toBe("true");

    const waterfall = { ...collectibles[0], id: "waterfall", primaryCategory: "waterfall" };
    const viewportStats = { totalCollectibles: 1, discoveredCount: 0, rareFinds: 0, epicFinds: 0, remainingCount: 1 };
    page.changeViewport({ collectibles: [waterfall], fartleks: [], stats: viewportStats, truncated: false });
    await vi.waitFor(() => expect(page.buttons.waterfall.hidden).toBe(false));
    expect(page.buttons.peak.hidden).toBe(true);
    expect(page.buttons.peak.attributes["aria-pressed"]).toBe("false");
    expect(page.buttons.all.attributes["aria-pressed"]).toBe("true");
    expect(page.collectibleIds()).toEqual(["waterfall"]);

    page.changeViewport({ collectibles: [], fartleks: [], stats: viewportStats, truncated: false });
    await vi.waitFor(() => expect(page.buttons.waterfall.hidden).toBe(true));
    expect(page.buttons.all.hidden).toBe(false);
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

  it("starts a bbox suggestion explicitly and shows its persistent instance", async () => {
    const page = await mount();
    page.questButton.handlers.click();
    await vi.waitFor(() => expect(page.quests.innerHTML).toContain("Active"));
    const startCall = page.fetchMock.mock.calls.find(([url]) => url === "/api/quest-instances/start");
    expect(startCall[1].method).toBe("POST");
    expect(JSON.parse(startCall[1].body)).toEqual({
      suggestionId: "suggestion-1",
      bbox: "8.00000,49.00000,11.00000,52.00000"
    });
    expect(page.quests.innerHTML).toContain("Active");
    expect(page.quests.innerHTML).toContain("Started");
    expect(page.fetchMock.mock.calls.filter(([url]) => url === "/api/quest-instances")).toHaveLength(2);
  });

  it("confirms cancellation, deletes the instance, and allows starting it again", async () => {
    const page = await mount();
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    page.questButton.handlers.click();
    await vi.waitFor(() => expect(page.quests.innerHTML).toContain("Active"));
    page.questCancelButton.handlers.click();
    await vi.waitFor(() => expect(page.quests.innerHTML).toContain("Start a local recommendation"));
    expect(page.fetchMock.mock.calls.some(([url, options]) =>
      url === "/api/quest-instances/instance-1" && options.method === "DELETE"
    )).toBe(true);
    expect(page.quests.innerHTML).toContain("Start quest");
    expect(globalThis.confirm).toHaveBeenCalledWith(
      "Cancel this quest and delete its progress? If you start it again, progress will start over."
    );
  });

  it("does not cancel a quest when the user declines confirmation", async () => {
    const page = await mount();
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    page.questButton.handlers.click();
    await vi.waitFor(() => expect(page.quests.innerHTML).toContain("Active"));
    page.questCancelButton.handlers.click();
    expect(page.fetchMock.mock.calls.some(([url]) => url === "/api/quest-instances/instance-1")).toBe(false);
    expect(page.quests.innerHTML).toContain("Cancel quest");
  });
});
