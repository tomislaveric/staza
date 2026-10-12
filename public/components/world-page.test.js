import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { availableWorldFilters, filteredWorldCollectibles, filteredWorldFartleks, mappedWorldCollectibles, mappedWorldFartleks, mountWorldPage, visibleWorldCollectibles, WorldFilterControls, worldFilters, WorldPage } from "./world-page.js";
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

  it("keeps selected quest Flowlines on the map regardless of the active filters", () => {
    expect(mappedWorldFartleks(fartleks, ["found"], [fartleks[0], fartleks[1]]))
      .toEqual(fartleks);
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

  it("keeps exploration cards equal-height and styles the Explore this Area entry point", () => {
    const css = readFileSync(new URL("../styles/world.css", import.meta.url), "utf8");
    expect(css).toContain("grid-auto-rows: 1fr;");
    expect(css).toContain("height: 100%;");
    expect(css).not.toContain("quest-suggestion");
    expect(css).toContain(".world-explore:focus-visible");
    expect(css).toMatch(/\.world-explore\s*\{[^}]*font-size:\s*20px;[^}]*min-height:\s*52px;[^}]*padding:\s*16px 20px;/s);
    expect(css).toMatch(/\.world-explore\s*\{[^}]*bottom:\s*16px;[^}]*left:\s*50%;[^}]*position:\s*absolute;[^}]*transform:\s*translateX\(-50%\)/s);
    expect(css).toContain(".quest-card-select:focus-visible");
    expect(css).toMatch(/\.quest-objective-groups\s*\{[^}]*display:\s*grid/s);
    expect(css).toMatch(/\.quest-instance-card article\s*\{[^}]*gap:\s*6px;[^}]*min-height:\s*0;[^}]*padding:\s*12px/s);
    expect(css).toMatch(/\.quest-card-head\s*\{[^}]*align-items:\s*center/s);
    expect(css).toMatch(/\.quest-instance-cancel\s*\{[^}]*height:\s*32px;[^}]*width:\s*32px/s);
  });
});

describe("mounted World page interactions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const flowlineObjective = { id: "flowlines", type: "flowline_rule", requiredCount: 1, targets: [{ id: "fartlek-1", name: "Harbour Straight" }] };
  const collectibleObjective = { id: "collectibles-viewpoint", type: "collectible_targets", requiredCount: 1, category: "viewpoint", targets: [{ id: "common-found", name: "Common" }] };
  const activeInstance = {
    id: "instance-1",
    suggestionId: "proposal-full",
    templateId: "exploration",
    templateVersion: 1,
    title: "Exploration: Harbour Straight & Common",
    description: "Visit 1 Flowline, 1 Viewpoint.",
    recommendedLevel: 1,
    status: "active",
    startedAt: "2026-04-01T10:00:00.000Z",
    objectives: [flowlineObjective, collectibleObjective].map((objective) => ({
      objective,
      progress: { completed: 0, required: 1, complete: false },
      targetProgress: objective.targets.map((target) => ({ ...target, complete: false }))
    }))
  };
  const remoteCollectible = { ...collectibles[0], id: "remote-place", name: "Remote Place", latitude: 55, longitude: 12 };
  const remoteFlowline = {
    ...fartleks[0], id: "remote-flowline", name: "Remote Flowline",
    geometry: { type: "LineString", coordinates: [[12, 55], [12.2, 55.2]] }
  };
  const remoteInstance = {
    ...activeInstance,
    id: "instance-remote",
    objectives: [
      { ...activeInstance.objectives[0], objective: { ...flowlineObjective, targets: [{ id: remoteFlowline.id, name: remoteFlowline.name }] } },
      { ...activeInstance.objectives[1], objective: { ...collectibleObjective, targets: [{ id: remoteCollectible.id, name: remoteCollectible.name }] } }
    ]
  };
  const routeGeometry = { type: "LineString", coordinates: [[9, 50], [9.1, 50.1], [9, 50]] };
  const quickGeometry = { type: "LineString", coordinates: [[9, 50], [9.05, 50.02], [9, 50]] };
  const customGeometry = { type: "LineString", coordinates: [[9, 50], [9.2, 50.2], [9, 50]] };
  const routeProposal = (id, label, includedTargetIds = ["common-found"], overrides = {}) => ({
    id, label, distanceM: 42_000, durationS: 6_000, geometry: routeGeometry,
    routeType: "round_trip", start: { lat: 50, lon: 9 }, end: { lat: 50, lon: 9 },
    includedTargetIds, nearbyTargetIds: [], recommended: false, constraintFit: "within",
    targetSummary: { peaks: 0, places: 1, other: 0 },
    traversedFlowlines: [{ id: "fartlek-1", name: "Harbour Straight", lengthMeters: 1000 }],
    ...overrides
  });
  const plannedRoute = {
    id: "route-1", questInstanceId: "instance-1", proposalId: "proposal-full", profile: "road_bike",
    routeType: "round_trip", start: { lat: 50, lon: 9 }, end: { lat: 50, lon: 9 },
    distanceM: 42_000, durationS: 6_000, geometry: routeGeometry, includedTargetIds: ["fartlek-1"],
    plannerVersion: 2, createdAt: "2026-04-01T10:00:00.000Z"
  };

  const mount = async ({ instances = [], generateError, rerouteError } = {}) => {
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
      "map", "status", "stats", "quests", "detail", "collectible-list", "locate", "explore"
    ].map((name) => [`[data-world-${name}]`, element()]));
    const questCancelButton = { ...element(), dataset: { questCancel: "instance-1" } };
    const questSelectButton = { ...element(), dataset: { questSelect: "instance:instance-1" } };
    const remoteQuestSelectButton = { ...element(), dataset: { questSelect: "instance:instance-remote" } };
    const detail = hosts["[data-world-detail]"];
    /** Dataset values the fake panel controls report when "clicked". */
    detail.datasets = {
      "[data-exploration-proposal]": { explorationProposal: "proposal-quick" },
      "[data-exploration-target]": { explorationTarget: "common-found" },
      "[data-exploration-remove]": { explorationRemove: "common-found" },
      "[data-exploration-pick]": { explorationPick: "start" }
    };
    detail.bound = {};
    detail.querySelectorAll = (selector) => {
      if (!selector.startsWith("[data-exploration-")) return [];
      const marker = selector.slice(1, -1);
      if (!detail.innerHTML.includes(marker)) return [];
      return [{
        dataset: detail.datasets[selector] ?? {},
        value: "",
        addEventListener(event, handler) { detail.bound[`${selector}:${event}`] = handler; }
      }];
    };
    const questHost = hosts["[data-world-quests]"];
    questHost.querySelectorAll = (selector) => selector === "[data-quest-cancel]" ? [questCancelButton]
      : selector === "[data-quest-select]" ? [questSelectButton, remoteQuestSelectButton] : [];
    const mountPoint = {
      innerHTML: "",
      querySelector: (selector) => hosts[selector],
      querySelectorAll: () => Object.values(buttons)
    };
    const stats = { totalCollectibles: 3, discoveredCount: 2, rareFinds: 0, epicFinds: 1, remainingCount: 1 };
    let viewportSnapshot = { collectibles, fartleks, stats, truncated: false };
    let activeInstances = instances;
    let customized = 0;
    const fetchMock = vi.fn(async (url, options) => {
      let body;
      if (url === "/api/world/basemap") body = { styleUrl: "/style.json" };
      else if (url === "/api/world") body = { stats };
      else if (url.startsWith("/api/world/quest-targets?")) {
        body = url.includes("remote-place")
          ? { collectibles: [remoteCollectible], flowlines: [remoteFlowline] }
          : { collectibles: [collectibles[0]], flowlines: [fartleks[0]] };
      }
      else if (url === "/api/quest-instances") body = { instances: activeInstances };
      else if (url === "/api/explorations/generate" && options?.method === "POST") {
        if (generateError) return { ok: false, status: 422, json: async () => generateError };
        body = {
          explorationId: "exp-1",
          proposals: [
            routeProposal("proposal-quick", "quick", ["common-found"], { geometry: quickGeometry }),
            routeProposal("proposal-balanced", "balanced", ["common-found"], { recommended: true })
          ],
          catalog: { collectibles: [collectibles[0], collectibles[1]], flowlines: [fartleks[0]] },
          truncated: false,
          limits: { maxRouteTargets: 12 }
        };
      }
      else if (url === "/api/explorations/exp-1/reroute" && options?.method === "POST") {
        if (rerouteError) return { ok: false, status: rerouteError.status ?? 422, json: async () => rerouteError };
        const request = JSON.parse(options.body);
        customized += 1;
        body = {
          proposal: routeProposal(`proposal-custom-${customized}`, "balanced", request.targetIds, {
            recommended: true, customized: true, basedOn: request.proposalId, geometry: customGeometry, constraintFit: "long"
          })
        };
      }
      else if (url === "/api/explorations/confirm" && options?.method === "POST") {
        activeInstances = [activeInstance];
        body = { instance: activeInstance, plannedRoute };
      }
      else if (url.endsWith("/planned-route")) {
        if (!url.includes("/instance-1/")) return { ok: false, status: 404, json: async () => ({ error: "No planned route." }) };
        body = plannedRoute;
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
      getView: () => ({ center: { lat: 50.5, lon: 9.5 }, zoom: 8 }),
      setCollectibles: vi.fn(), setFartleks: vi.fn(), setDetailPanelOpen: vi.fn(),
      setRoute: vi.fn(), setAlternateRoutes: vi.fn(), fitTo: vi.fn(), setRouteEndpoints: vi.fn(),
      setPickHandler: vi.fn(), isPicking: vi.fn(() => false)
    };
    const createMap = vi.spyOn(worldMap, "createWorldMap").mockResolvedValue(map);
    await mountWorldPage(mountPoint);
    const exploreButton = hosts["[data-world-explore]"];
    const page = {
      click: (filter) => buttons[filter].handlers.click(),
      bound: (key) => detail.bound[key],
      /** NORMAL → CONFIGURE with a start picked on the map. */
      configure: () => {
        exploreButton.handlers.click();
        map.setPickHandler.mock.lastCall[0]({ lat: 50, lon: 9 });
      },
      /** CONFIGURE → GENERATING → CUSTOMIZE with the recommended proposal selected. */
      generate: async () => {
        page.configure();
        detail.bound["[data-exploration-form]:submit"]({ preventDefault() {} });
        await vi.waitFor(() => expect(detail.innerHTML).toContain("Step 2"));
      },
      startExploration: async () => {
        await page.generate();
        detail.bound["[data-exploration-confirm]:click"]();
        await vi.waitFor(() => expect(questHost.innerHTML).toContain('data-quest-cancel="instance-1"'));
      },
      calls: (url, method) => fetchMock.mock.calls.filter(([calledUrl, options]) =>
        calledUrl === url && (!method || options?.method === method)),
      buttons, map, fetchMock, exploreButton, questCancelButton, questSelectButton, remoteQuestSelectButton,
      callbacks: createMap.mock.calls[0][1],
      detail,
      mountPoint,
      status: hosts["[data-world-status]"],
      changeViewport: (snapshot) => {
        viewportSnapshot = snapshot;
        createMap.mock.calls[0][1].onViewportChange(map.getBounds());
      },
      quests: questHost,
      collectibleIds: () => map.setCollectibles.mock.lastCall[0].features.map((feature) => feature.id),
      fartlekIds: () => map.setFartleks.mock.lastCall[0].features.map((feature) => feature.id),
      collectibleFeature: (id) => map.setCollectibles.mock.lastCall[0].features.find((feature) => feature.id === id),
      fartlekFeature: (id) => map.setFartleks.mock.lastCall[0].features.find((feature) => feature.id === id)
    };
    return page;
  };

  it("toggles a union, removes individual filters, and resets without refetching", async () => {
    const page = await mount();
    expect(page.quests.innerHTML).toContain("Your Explorations");
    expect(page.quests.innerHTML).not.toContain("Local recommendations");
    expect(page.mountPoint.innerHTML).toContain("EXPLORE THIS AREA");
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
    expect(page.fetchMock.mock.calls.some(([url]) => url.includes("includeQuestSuggestions"))).toBe(false);
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
    expect(page.collectibleFeature("epic-found").properties.selected).toBe(true);
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

  it("highlights a started exploration's targets, includes filtered targets, and frames them with its route", async () => {
    const page = await mount({ instances: [activeInstance] });
    page.click("rare");
    page.questSelectButton.handlers.click();

    await vi.waitFor(() => expect(page.map.fitTo).toHaveBeenCalled());
    expect(page.calls("/api/world/quest-targets?collectibleId=common-found&flowlineId=fartlek-1")).toHaveLength(1);
    expect(page.collectibleFeature("common-found").properties).toMatchObject({ questTarget: true, questRelated: true });
    expect(page.collectibleFeature("rare-unfound").properties.questRelated).toBe(false);
    expect(page.map.setFartleks.mock.lastCall[0].features
      .find((feature) => feature.id === "fartlek-1").properties).toMatchObject({ questTarget: true, questRelated: true });
    expect(page.map.fitTo.mock.lastCall[0]).toEqual(expect.arrayContaining([
      { latitude: 49, longitude: 8 },
      { latitude: 49.01, longitude: 8.01 },
      { latitude: 50.1, longitude: 9.1 }
    ]));
    expect(page.map.setRoute).toHaveBeenLastCalledWith({ geometry: routeGeometry });
    expect(page.quests.innerHTML).toContain("Planned route");

    page.questSelectButton.handlers.click();
    expect(page.collectibleIds()).toEqual(["rare-unfound"]);
    expect(page.map.setFartleks.mock.lastCall[0].features).toEqual([]);
    expect(page.map.setRoute).toHaveBeenLastCalledWith(undefined);
  });

  it("loads and frames frozen exploration targets outside the current viewport", async () => {
    const page = await mount({ instances: [remoteInstance] });
    page.remoteQuestSelectButton.handlers.click();

    await vi.waitFor(() => expect(page.map.fitTo).toHaveBeenCalled());
    expect(page.fetchMock.mock.calls.some(([url]) => url.includes("collectibleId=remote-place")
      && url.includes("flowlineId=remote-flowline"))).toBe(true);
    expect(page.collectibleFeature("remote-place").properties.questTarget).toBe(true);
    expect(page.map.setFartleks.mock.lastCall[0].features
      .find((feature) => feature.id === "remote-flowline").properties.questTarget).toBe(true);
    expect(page.map.fitTo).toHaveBeenCalledWith([
      { latitude: 55, longitude: 12 },
      { latitude: 55, longitude: 12 },
      { latitude: 55.2, longitude: 12.2 }
    ]);
  });

  const submit = (page) => page.bound("[data-exploration-form]:submit")({ preventDefault() {} });
  const pressed = (page, id) => page.detail.innerHTML.includes(`data-exploration-proposal="${id}" aria-pressed="true"`);

  it("configures only the ride before generating, with World markers dimmed and no targets", async () => {
    const page = await mount();
    page.exploreButton.handlers.click();
    expect(page.exploreButton.hidden).toBe(true);
    expect(page.detail.innerHTML).toContain("Step 1");
    expect(page.detail.innerHTML).toContain("data-exploration-locate");
    expect(page.detail.innerHTML).toContain("Generate Routes");
    expect(page.detail.innerHTML).not.toContain("Included destinations");
    expect(page.detail.innerHTML).not.toContain("data-exploration-remove");
    expect(page.collectibleIds()).toEqual(collectibles.map((item) => item.id));
    expect(page.map.setCollectibles.mock.lastCall[0].features.every((feature) => !feature.properties.questRelated)).toBe(true);
    expect(page.map.setFartleks.mock.lastCall[0].features.every((feature) => !feature.properties.questRelated)).toBe(true);

    page.map.setPickHandler.mock.lastCall[0]({ lat: 50, lon: 9 });
    expect(page.map.setPickHandler).toHaveBeenLastCalledWith(undefined);
    expect(page.map.setRouteEndpoints).toHaveBeenLastCalledWith({ start: { lat: 50, lon: 9 }, end: undefined });
    expect(page.detail.innerHTML).toContain("50.0000, 9.0000");
    expect(page.fetchMock.mock.calls.some(([url]) => url.startsWith("/api/explorations"))).toBe(false);
    expect(page.detail.innerHTML).not.toContain("Included destinations");
  });

  it("generates routes from the ride alone and auto-selects the recommended one", async () => {
    const page = await mount();
    await page.generate();
    expect(JSON.parse(page.calls("/api/explorations/generate", "POST")[0][1].body)).toEqual({
      area: { bbox: "8.00000,49.00000,11.00000,52.00000", center: { lat: 50.5, lon: 9.5 }, zoom: 8 },
      routeType: "round_trip",
      start: { lat: 50, lon: 9 },
      constraint: { type: "distance", value: 50_000 }
    });
    expect(page.detail.innerHTML).toContain("Quick");
    expect(page.detail.innerHTML).toContain("Balanced");
    expect(page.detail.innerHTML).toContain("Recommended");
    expect(pressed(page, "proposal-balanced")).toBe(true);
    expect(page.map.setRoute).toHaveBeenLastCalledWith({ geometry: routeGeometry });
    expect(page.map.setAlternateRoutes).toHaveBeenLastCalledWith([]);
    expect(page.map.fitTo).toHaveBeenCalled();
    expect(page.detail.innerHTML).toContain("Included destinations");
    expect(page.detail.innerHTML).toContain("Harbour Straight");
    expect(page.collectibleIds()).toEqual(["common-found", "rare-unfound"]);
    expect(page.collectibleFeature("common-found").properties.questTarget).toBe(true);
    expect(page.collectibleFeature("rare-unfound").properties.questRelated).toBe(false);
    expect(page.detail.innerHTML).toMatch(/data-exploration-confirm>Start Exploration/);
  });

  it("uses the device location only after Locate Me is pressed", async () => {
    const page = await mount();
    const getCurrentPosition = vi.fn((success) => success({ coords: { latitude: 50.2, longitude: 9.2 } }));
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
    page.exploreButton.handlers.click();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    page.bound("[data-exploration-locate]:click")();
    expect(page.detail.innerHTML).toContain("50.2000, 9.2000");
    submit(page);
    await vi.waitFor(() => expect(page.detail.innerHTML).toContain("Step 2"));
    expect(JSON.parse(page.calls("/api/explorations/generate", "POST")[0][1].body).start).toEqual({ lat: 50.2, lon: 9.2 });
  });

  it("shows only the hovered or selected proposal on the map", async () => {
    const page = await mount();
    await page.generate();
    page.bound("[data-exploration-proposal]:mouseenter")();
    expect(page.map.setRoute).toHaveBeenLastCalledWith({ geometry: quickGeometry });
    expect(page.map.setAlternateRoutes).toHaveBeenLastCalledWith([]);
    page.bound("[data-exploration-proposal]:mouseleave")();
    expect(page.map.setRoute).toHaveBeenLastCalledWith({ geometry: routeGeometry });
    expect(pressed(page, "proposal-balanced")).toBe(true);

    page.bound("[data-exploration-proposal]:click")();
    expect(pressed(page, "proposal-quick")).toBe(true);
    expect(page.map.setRoute).toHaveBeenLastCalledWith({ geometry: quickGeometry });
    expect(page.map.setAlternateRoutes).toHaveBeenLastCalledWith([]);
    expect(page.collectibleFeature("common-found").properties.questTarget).toBe(true);
    expect(page.map.setFartleks.mock.lastCall[0].features.find((feature) => feature.id === "fartlek-1").properties.questRelated).toBe(true);
    expect(page.calls("/api/explorations/generate")).toHaveLength(1);
  });

  it("highlights an included target on the map while its list row is hovered", async () => {
    const page = await mount();
    await page.generate();
    expect(page.collectibleFeature("common-found").properties.selected).toBe(false);
    page.bound("[data-exploration-target]:mouseenter")();
    expect(page.collectibleFeature("common-found").properties.selected).toBe(true);
    page.bound("[data-exploration-target]:mouseleave")();
    expect(page.collectibleFeature("common-found").properties.selected).toBe(false);
  });

  it("customizes only the selected route: add and remove re-plan it, Reset restores it", async () => {
    const page = await mount();
    await page.generate();
    page.callbacks.onCollectibleSelect("rare-unfound");
    expect(page.calls("/api/explorations/exp-1/reroute")).toHaveLength(0);

    page.bound("[data-exploration-add]:click")();
    expect(page.collectibleFeature("rare-unfound").properties.questRelated).toBe(true);
    page.callbacks.onCollectibleHover("rare-unfound");
    expect(page.collectibleFeature("rare-unfound").properties.selected).toBe(true);
    page.callbacks.onCollectibleHover(undefined);
    page.callbacks.onCollectibleSelect("rare-unfound");
    await vi.waitFor(() => expect(page.detail.innerHTML).toContain("Customized"));
    expect(JSON.parse(page.calls("/api/explorations/exp-1/reroute", "POST")[0][1].body))
      .toEqual({ proposalId: "proposal-balanced", targetIds: ["common-found", "rare-unfound"] });
    expect(page.map.setRoute).toHaveBeenLastCalledWith({ geometry: customGeometry });
    expect(page.map.setAlternateRoutes).toHaveBeenLastCalledWith([]);
    expect(page.collectibleFeature("rare-unfound").properties.questTarget).toBe(true);
    expect(page.detail.innerHTML).toContain("This route is longer than your planned ride.");
    expect(page.detail.innerHTML).toContain("data-exploration-reset");

    page.bound("[data-exploration-remove]:click")();
    await vi.waitFor(() => expect(page.calls("/api/explorations/exp-1/reroute", "POST")).toHaveLength(2));
    expect(JSON.parse(page.calls("/api/explorations/exp-1/reroute", "POST")[1][1].body))
      .toEqual({ proposalId: "proposal-custom-1", targetIds: ["rare-unfound"] });
    await vi.waitFor(() => expect(page.detail.innerHTML).not.toContain("Updating route"));
    expect(page.collectibleFeature("common-found").properties.questRelated).toBe(false);

    page.bound("[data-exploration-reset]:click")();
    expect(page.detail.innerHTML).not.toContain("Customized");
    expect(page.map.setRoute).toHaveBeenLastCalledWith({ geometry: routeGeometry });
    expect(page.calls("/api/explorations/generate")).toHaveLength(1);
    expect(page.calls("/api/explorations/exp-1/reroute")).toHaveLength(2);
  });

  it("keeps the previous route when re-planning fails and restarts when routes expired", async () => {
    const page = await mount({ rerouteError: { error: "No suitable route was found.", code: "no_route" } });
    await page.generate();
    page.bound("[data-exploration-add]:click")();
    page.callbacks.onCollectibleSelect("rare-unfound");
    await vi.waitFor(() => expect(page.detail.innerHTML).toContain("No suitable route was found."));
    expect(page.detail.innerHTML).toContain("Step 2");
    expect(page.detail.innerHTML).toContain('data-exploration-remove="common-found"');
    expect(page.map.setRoute).toHaveBeenLastCalledWith({ geometry: routeGeometry });

    const expired = await mount({ rerouteError: { error: "Expired.", code: "exploration_expired", status: 409 } });
    await expired.generate();
    expired.bound("[data-exploration-add]:click")();
    expired.callbacks.onCollectibleSelect("rare-unfound");
    await vi.waitFor(() => expect(expired.detail.innerHTML).toContain("These routes expired."));
    expect(expired.detail.innerHTML).toContain("Step 1");
    expect(expired.map.setRoute).toHaveBeenLastCalledWith(undefined);
  });

  it("starts exactly the selected, possibly customized route", async () => {
    const page = await mount();
    await page.generate();
    page.bound("[data-exploration-add]:click")();
    page.callbacks.onCollectibleSelect("rare-unfound");
    await vi.waitFor(() => expect(page.detail.innerHTML).toContain("Customized"));
    page.bound("[data-exploration-confirm]:click")();
    await vi.waitFor(() => expect(page.quests.innerHTML).toContain('data-quest-cancel="instance-1"'));
    expect(JSON.parse(page.calls("/api/explorations/confirm", "POST")[0][1].body)).toEqual({ proposalId: "proposal-custom-1" });
    expect(page.quests.innerHTML).toContain("Planned route");
    expect(page.detail.innerHTML).not.toContain("data-exploration-confirm");
    expect(page.exploreButton.hidden).toBe(false);
    expect(page.map.setAlternateRoutes).toHaveBeenLastCalledWith([]);
    expect(page.map.setRoute).toHaveBeenLastCalledWith({ geometry: routeGeometry });
    expect(page.calls("/api/quest-instances")).toHaveLength(2);
  });

  it("returns to the ride configuration and discards proposals when the ride changes", async () => {
    const page = await mount();
    await page.generate();
    page.bound("[data-exploration-edit-ride]:click")();
    expect(page.detail.innerHTML).toContain("Step 1");
    expect(page.detail.innerHTML).not.toContain("data-exploration-proposal");
    expect(page.map.setRoute).toHaveBeenLastCalledWith(undefined);
    expect(page.map.setAlternateRoutes).toHaveBeenLastCalledWith([]);
    page.bound("[data-exploration-constraint]:click")();
    submit(page);
    await vi.waitFor(() => expect(page.calls("/api/explorations/generate", "POST")).toHaveLength(2));
  });

  it("cancels from any phase back to the normal map without network cleanup", async () => {
    const page = await mount();
    page.exploreButton.handlers.click();
    page.bound("[data-exploration-cancel]:click")();
    expect(page.detail.hidden).toBe(true);
    expect(page.exploreButton.hidden).toBe(false);
    expect(page.map.setPickHandler).toHaveBeenLastCalledWith(undefined);

    await page.generate();
    const callsBefore = page.fetchMock.mock.calls.length;
    page.bound("[data-exploration-cancel]:click")();
    expect(page.fetchMock.mock.calls.length).toBe(callsBefore);
    expect(page.collectibleIds()).toEqual(collectibles.map((item) => item.id));
    expect(page.collectibleFeature("common-found").properties.questRelated).toBe(true);
    expect(page.map.setRoute).toHaveBeenLastCalledWith(undefined);
    expect(page.map.setAlternateRoutes).toHaveBeenLastCalledWith([]);
    expect(page.map.setRouteEndpoints).toHaveBeenLastCalledWith({});
  });

  it("explains failed generation and stays in configuration", async () => {
    const page = await mount({ generateError: { error: "No exploration targets can be reached.", code: "no_reachable_targets" } });
    page.configure();
    submit(page);
    await vi.waitFor(() => expect(page.detail.innerHTML).toContain("No exploration targets can be reached."));
    expect(page.detail.innerHTML).toContain("Step 1");
    expect(page.detail.innerHTML).toContain("Generate Routes");
  });

  it("confirms cancellation and deletes the started exploration", async () => {
    const page = await mount();
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    await page.startExploration();
    page.questCancelButton.handlers.click();
    await vi.waitFor(() => expect(page.quests.innerHTML).toContain("Use Explore this Area"));
    expect(page.calls("/api/quest-instances/instance-1", "DELETE")).toHaveLength(1);
    expect(globalThis.confirm).toHaveBeenCalledWith("Cancel this exploration and delete its progress? This cannot be undone.");
    expect(page.map.setRoute).toHaveBeenLastCalledWith(undefined);
  });

  it("does not cancel an exploration when the user declines confirmation", async () => {
    const page = await mount();
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    await page.startExploration();
    page.questCancelButton.handlers.click();
    expect(page.calls("/api/quest-instances/instance-1")).toHaveLength(0);
    expect(page.quests.innerHTML).toContain('aria-label="Cancel exploration"');
  });
});
