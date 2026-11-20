import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { availableWorldFilters, distanceBetween, WorldDiscovered, WorldExploreControls, filteredWorldCollectibles, filteredWorldFartleks, mappedWorldCollectibles, mappedWorldFartleks, mountWorldPage, visibleWorldCollectibles, WorldFilterControls, worldFilters, WorldPage } from "./world-page.js";
import { CollectibleSwatch } from "./world/collectible-swatch.js";
import * as worldMarkers from "./world/world-markers.js";
import * as worldMap from "./world/world-map.js";

describe("WorldExploreControls", () => {
  it("renders the state-driven Explore CTA beside a small Plan route button that counts route picks", () => {
    const markup = WorldExploreControls({ exploreAllowed: true, knownFlowlines: 0, availableFlowlines: 3 }, { stopCount: 2 });
    expect(markup).toContain('data-world-explore="explore"');
    expect(markup).toContain(">Explore this area<");
    expect(markup).toContain("Plan route \u00b7 2");
    expect(markup).not.toMatch(/hidden Flowline/i);
    expect(WorldExploreControls(undefined)).toMatch(/data-world-explore="zoom" disabled>Zoom in to explore/);
  });
});

const collectibles = [
  { id: "viewpoint-found", name: "Viewpoint", type: "landmark", primaryCategory: "viewpoint", found: true, latitude: 49, longitude: 8 },
  { id: "peak-unfound", name: "Peak", type: "landmark", primaryCategory: "peak", found: false, latitude: 50, longitude: 9 },
  { id: "castle-found", name: "Castle", type: "landmark", primaryCategory: "castle", found: true, latitude: 51, longitude: 10 }
];

const fartleks = [
  { id: "fartlek-1", name: "Harbour Straight", completed: false, geometry: { type: "LineString", coordinates: [[8, 49], [8.01, 49.01]] }, lengthMeters: 1000 },
  { id: "fartlek-2", name: "River Run", completed: true, geometry: { type: "LineString", coordinates: [[9, 50], [9.01, 50.01]] }, lengthMeters: 1000 }
];

describe("World page data transformations", () => {
  it("offers advanced filters only when granted and applies them to collectibles and Flowlines", () => {
    expect(availableWorldFilters(collectibles, fartleks).has("high-flow")).toBe(false);
    const granted = availableWorldFilters(collectibles, fartleks, ["high-flow", "peaks-only", "not-a-filter"]);
    expect(granted.has("high-flow")).toBe(true);
    expect(granted.has("peaks-only")).toBe(true);
    expect(granted.has("not-a-filter")).toBe(false);

    const flowlines = [
      { ...fartleks[0], flowScore: 80, lengthMeters: 6000 },
      { ...fartleks[1], flowScore: 40, lengthMeters: 1000 }
    ];
    expect(filteredWorldFartleks(flowlines, ["high-flow"]).map((item) => item.id)).toEqual(["fartlek-1"]);
    expect(filteredWorldFartleks(flowlines, ["long-endurance"]).map((item) => item.id)).toEqual(["fartlek-1"]);
    expect(filteredWorldFartleks(flowlines, ["undiscovered-only"]).map((item) => item.id)).toEqual(["fartlek-1"]);
    expect(filteredWorldCollectibles(collectibles, ["peaks-only"]).map((item) => item.id)).toEqual(["peak-unfound"]);
    expect(filteredWorldCollectibles(collectibles, ["high-flow"])).toEqual([]);
  });

  it("offers only matching filters while always retaining All", () => {
    expect([...availableWorldFilters([], [])]).toEqual(["all"]);
    expect([...availableWorldFilters(collectibles, [])]).toEqual([
      "all", "found", "unfound", "viewpoint", "peak", "castle"
    ]);
    expect([...availableWorldFilters([], fartleks)]).toEqual(["all", "fartleks"]);
    expect([...availableWorldFilters([{ ...collectibles[0], visibility: "hidden" }], [])]).toEqual(["all"]);
  });

  it("makes the mountain-pass filter available only when a visible pass exists", () => {
    const pass = { ...collectibles[0], id: "pass", primaryCategory: "mountain_pass" };
    expect(availableWorldFilters([pass], []).has("mountain_pass")).toBe(true);
    expect(availableWorldFilters([{ ...pass, visibility: "hidden" }], []).has("mountain_pass")).toBe(false);
  });

  it("filters collectibles by discovery state and category", () => {
    expect(filteredWorldCollectibles(collectibles, ["found"]).map((item) => item.id)).toEqual(["viewpoint-found", "castle-found"]);
    expect(filteredWorldCollectibles(collectibles, ["unfound"]).map((item) => item.id)).toEqual(["peak-unfound"]);
    expect(filteredWorldCollectibles(collectibles, ["peak"]).map((item) => item.id)).toEqual(["peak-unfound"]);
    expect(filteredWorldCollectibles(collectibles, ["castle"]).map((item) => item.id)).toEqual(["castle-found"]);
  });

  it("keeps future hidden markers out of all filter states without changing discovery filters", () => {
    const hidden = {
      id: "hidden-collectible",
      found: false,
      latitude: 52,
      longitude: 11,
      visibility: "hidden"
    };
    const withHidden = [...collectibles, hidden];

    expect(visibleWorldCollectibles(withHidden).map((item) => item.id)).toEqual([
      "viewpoint-found", "peak-unfound", "castle-found"
    ]);
    for (const filters of [[], ["castle"], ["unfound", "castle"], ["fartleks", "castle"]]) {
      expect(filteredWorldCollectibles(withHidden, filters)).not.toContain(hidden);
    }
  });

  it("shows the union of discovery and category matches without duplicates", () => {
    expect(filteredWorldCollectibles(collectibles, ["found", "peak"]).map((item) => item.id))
      .toEqual(["viewpoint-found", "peak-unfound", "castle-found"]);
    expect(filteredWorldCollectibles(collectibles, ["unfound", "castle"]).map((item) => item.id))
      .toEqual(["peak-unfound", "castle-found"]);
    expect(filteredWorldCollectibles(collectibles, ["found", "unfound"])).toEqual(collectibles);
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
      .toEqual(["peak-unfound", "castle-found"]);
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
    const hidden = { id: "hidden", found: false, latitude: 52, longitude: 11, visibility: "hidden" };

    expect(mappedWorldCollectibles([...collectibles, hidden], []).map((item) => item.id))
      .toEqual(["viewpoint-found", "peak-unfound", "castle-found"]);
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
    const markup = WorldFilterControls(["peak", "castle"], allCategories, fartleks);
    expect(worldFilters).toEqual(["all", "found", "unfound", "fartleks", "viewpoint", "peak", "castle", "waterfall", "place", "mountain_pass"]);
    expect(markup).toContain('role="group" aria-label="World collectibles and Flowlines"');
    expect(markup).not.toContain('role="tab');
    expect(markup).not.toContain("aria-selected");
    for (const filter of worldFilters) {
      expect(buttonMarkup(markup, filter)).toContain(`aria-pressed="${filter === "peak" || filter === "castle"}"`);
      expect(buttonMarkup(markup, filter)).toContain('type="button"');
    }
  });

  it("marks only All as active when no filters are selected", () => {
    const markup = WorldFilterControls([], collectibles, fartleks);
    expect(buttonMarkup(markup, "all")).toContain('aria-pressed="true"');
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it("makes locked filters link to their Skill Atlas node", () => {
    const markup = WorldFilterControls([], collectibles, fartleks, [], [
      { id: "high-flow", nodeId: "rusher-ii", nodeName: "Rusher II" }
    ]);

    expect(markup).toContain('type="button" data-world-filter-unlock="rusher-ii"');
    expect(markup).toContain("Unlock Rusher II in the Skill Atlas");
  });

  it("reuses the marker swatches for discovery, categories, and Fartleks", () => {
    const markup = WorldFilterControls([], [
      ...collectibles,
      { ...collectibles[0], id: "waterfall", primaryCategory: "waterfall" },
      { ...collectibles[0], id: "place", primaryCategory: "place" },
      { ...collectibles[0], id: "mountain-pass", primaryCategory: "mountain_pass" }
    ], fartleks);
    expect(buttonMarkup(markup, "found")).toContain(CollectibleSwatch({ visited: true }));
    expect(buttonMarkup(markup, "unfound")).toContain(CollectibleSwatch({ visited: false }));
    for (const category of ["viewpoint", "peak", "castle", "waterfall", "place", "mountain_pass"]) {
      expect(buttonMarkup(markup, category)).toContain(CollectibleSwatch({ category }));
    }
    for (const [category, icon] of [
      ["castle", "\u26eb"],
      ["mountain_pass", "\u26f0"],
      ["peak", "\u25b2"]
    ]) {
      expect(CollectibleSwatch({ category })).toContain(icon);
      expect(CollectibleSwatch({ category })).toContain("is-icon");
      expect(CollectibleSwatch({ category, visited: true })).toContain("is-visited");
    }
    for (const category of ["viewpoint", "place", "waterfall"]) {
      expect(CollectibleSwatch({ category })).toContain(`collectible-${category}-muted.svg`);
      expect(CollectibleSwatch({ category, visited: true })).toContain(`collectible-${category}.svg`);
      expect(CollectibleSwatch({ category })).toContain("is-svg");
    }
    expect(buttonMarkup(markup, "fartleks")).toContain('<b class="fartlek-swatch" aria-hidden="true"></b>');
    expect(markup).not.toContain("is-completed");
    expect(buttonMarkup(markup, "viewpoint")).toContain("collectible-viewpoint-muted.svg");
    expect(buttonMarkup(markup, "place")).toContain("collectible-place-muted.svg");
  });

  it("scopes Discovered to the visible area and measures distance", () => {
    expect(WorldDiscovered()).toContain("\u2013");
    expect(WorldDiscovered({ discoveredCount: 2, totalCollectibles: 9 })).toContain("2");
    const metres = distanceBetween({ latitude: 50, longitude: 9 }, { latitude: 50, longitude: 10 });
    expect(Math.round(metres / 1000)).toBe(71);
  });

  it("renders one filter group without a map-overlay legend", () => {
    const markup = WorldPage({ stats: { discoveredCount: 1, totalCollectibles: 3 }, selectedFilters: [] });
    expect(markup.match(/class="world-filter-controls"/g)).toHaveLength(1);
    expect(markup).not.toContain("world-legend");
    expect(markup).not.toContain("World marker legend");
    expect(worldMarkers.WorldLegend).toBeUndefined();
    expect(buttonMarkup(WorldFilterControls([]), "all")).not.toContain(" hidden");
  });

  it("keeps the exploration panel separate from the map frame", () => {
    const markup = WorldPage({ stats: undefined, selectedFilters: [] });
    expect(markup).toMatch(/class="world-map-frame">[\s\S]*<\/div>\s*<div class="world-detail-host"/);
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
    expect(css).toMatch(/\.world-locate, \.world-explore, \.world-plan-route\s*\{[^}]*font-size:\s*10px;[^}]*padding:\s*8px 10px;/s);
    expect(css).toMatch(/\.world-explore-cta\s*\{[^}]*bottom:\s*16px;[^}]*left:\s*50%;[^}]*position:\s*absolute;[^}]*transform:\s*translateX\(-50%\)/s);
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
  const collectibleObjective = { id: "collectibles-viewpoint", type: "collectible_targets", requiredCount: 1, category: "viewpoint", targets: [{ id: "viewpoint-found", name: "Common" }] };
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
  const routeProposal = (id, label, includedTargetIds = ["viewpoint-found"], overrides = {}) => ({
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

  const planProposal = (overrides = {}) => routeProposal("proposal-plan", "balanced", ["viewpoint-found"], {
    customized: true, flowlineIds: ["fartlek-1"], stopOrder: ["viewpoint-found", "flowline:fartlek-1"], ...overrides
  });
  const discovered = {
    outcome: "discovered",
    revealed: [
      { ...fartleks[0], id: "fresh-1", name: "Rheintal Flowline", flowScore: 84, roadQualityScore: 91, character: { primary: "flow", tags: ["flow"] } },
      { ...fartleks[0], id: "fresh-2", name: "Long Valley", enduranceScore: 80, character: { primary: "endurance", tags: ["endurance"] } }
    ],
    knownCount: 2,
    availableCount: 0,
    summary: { total: 2, byCharacter: { flow: 1, endurance: 1, explore: 0 } }
  };

  /** A host whose buttons exist while its markup contains their data attribute; clicks call the bound handler. */
  const fakeHost = (base) => {
    base.datasets = {};
    base.bound = {};
    const matches = (selector) => {
      const marker = selector.slice(1, -1);
      return new RegExp(`${marker}(?![\\w-])`).test(base.innerHTML);
    };
    const button = (selector) => {
      const element = {
        get dataset() { return base.datasets[selector] ?? {}; },
        addEventListener(event, handler) {
          base.bound[`${selector}:${event}`] = (domEvent) => handler(domEvent ?? { currentTarget: element, preventDefault() {} });
        }
      };
      return element;
    };
    base.querySelectorAll = (selector) => matches(selector) ? [button(selector)] : [];
    base.querySelector = (selector) => matches(selector) ? button(selector) : undefined;
    return base;
  };

  const mount = async ({ instances = [], generateError, planError, exploreResult = discovered, savedHome, areaStatus } = {}) => {
    let savedHomeValue = savedHome ? JSON.stringify(savedHome) : null;
    const localStorage = {
      getItem: vi.fn(() => savedHomeValue),
      setItem: vi.fn((_key, value) => { savedHomeValue = value; })
    };
    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
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
      "map", "status", "stats", "discovered", "quests", "detail", "collectible-list", "locate", "explore-cta", "explore-card"
    ].map((name) => [`[data-world-${name}]`, element()]));
    const questCancelButton = { ...element(), dataset: { questCancel: "instance-1" } };
    const questSelectButton = { ...element(), dataset: { questSelect: "instance:instance-1" } };
    const remoteQuestSelectButton = { ...element(), dataset: { questSelect: "instance:instance-remote" } };
    const detail = fakeHost(hosts["[data-world-detail]"]);
    const cta = fakeHost(hosts["[data-world-explore-cta]"]);
    const card = fakeHost(hosts["[data-world-explore-card]"]);
    const questHost = hosts["[data-world-quests]"];
    questHost.querySelectorAll = (selector) => selector === "[data-quest-cancel]" ? [questCancelButton]
      : selector === "[data-quest-select]" ? [questSelectButton, remoteQuestSelectButton] : [];
    const mountPoint = {
      innerHTML: "",
      querySelector: (selector) => hosts[selector],
      querySelectorAll: () => Object.values(buttons)
    };
    const stats = { totalCollectibles: 3, discoveredCount: 2, remainingCount: 1 };
    let viewportSnapshot = {
      collectibles, fartleks, stats, truncated: false,
      areaStatus: areaStatus ?? { exploreAllowed: true, knownFlowlines: 0, availableFlowlines: 2 }
    };
    let activeInstances = instances;
    let viewportShifts = 0;
    const fetchMock = vi.fn(async (url, options) => {
      let body;
      if (url === "/api/world/basemap") body = { styleUrl: "/style.json" };
      else if (url === "/api/world/explore" && options?.method === "POST") body = exploreResult;
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
            routeProposal("proposal-quick", "quick", ["viewpoint-found"], { geometry: quickGeometry }),
            routeProposal("proposal-balanced", "balanced", ["peak-unfound"], { recommended: true })
          ],
          catalog: { collectibles: [collectibles[0], collectibles[1]], flowlines: [fartleks[0]] },
          truncated: false,
          limits: { maxRouteTargets: 12 }
        };
      }
      else if (url === "/api/explorations/plan" && options?.method === "POST") {
        if (planError) return { ok: false, status: 422, json: async () => planError };
        body = { explorationId: "plan-1", proposal: planProposal(), catalog: { collectibles, flowlines: fartleks }, truncated: false };
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
      setPickHandler: vi.fn(), setMapClickHandler: vi.fn(), showPointTooltip: vi.fn(), isPicking: vi.fn(() => false),
      setHomePosition: vi.fn(), flyTo: vi.fn()
    };
    const createMap = vi.spyOn(worldMap, "createWorldMap").mockResolvedValue(map);
    await mountWorldPage(mountPoint);
    const page = {
      click: (filter) => buttons[filter].handlers.click(),
      bound: (key) => detail.bound[key],
      /** Fake buttons read their dataset when clicked. */
      setDataset: (selector, dataset) => { detail.datasets[selector] = dataset; },
      explore: () => cta.bound["[data-world-explore]:click"](),
      openPlanner: () => cta.bound["[data-world-plan]:click"](),
      card: (selector) => card.bound[`${selector}:click`](),
      /** Opens the planner with the first Flowline picked and routes it. */
      route: async () => {
        page.setDataset("[data-flowline-add-route]", { flowlineAddRoute: "fartlek-1" });
        page.callbacks.onFartlekSelect("fartlek-1");
        detail.bound["[data-flowline-add-route]:click"]();
        page.openPlanner();
        detail.bound["[data-planner-route]:click"]();
        await vi.waitFor(() => expect(detail.innerHTML).toContain("data-planner-confirm"));
      },
      startExploration: async () => {
        await page.route();
        detail.bound["[data-planner-confirm]:click"]();
        await vi.waitFor(() => expect(questHost.innerHTML).toContain('data-quest-cancel="instance-1"'));
      },
      calls: (url, method) => fetchMock.mock.calls.filter(([calledUrl, options]) =>
        calledUrl === url && (!method || options?.method === method)),
      buttons, map, fetchMock, cta, exploreCard: card, questCancelButton, questSelectButton, remoteQuestSelectButton,
      callbacks: createMap.mock.calls[0][1],
      localStorage,
      savedHome: () => savedHomeValue ? JSON.parse(savedHomeValue) : undefined,
      detail,
      mountPoint,
      status: hosts["[data-world-status]"],
      changeViewport: (snapshot) => {
        viewportSnapshot = snapshot;
        // Each change leaves the previously cached collectible area, forcing a reload.
        const shift = (viewportShifts += 20);
        const { west, south, east, north } = map.getBounds();
        createMap.mock.calls[0][1].onViewportChange({ west: west + shift, south, east: east + shift, north });
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
    expect(page.cta.innerHTML).toContain(">Explore this area<");
    expect(page.buttons.all.hidden).toBe(false);
    expect(page.buttons.waterfall.hidden).toBe(true);
    expect(page.buttons.place.hidden).toBe(true);
    page.click("peak");
    expect(page.collectibleIds()).toEqual(["peak-unfound"]);
    expect(page.fartlekIds()).toEqual([]);
    page.click("found");
    expect(page.collectibleIds()).toEqual(collectibles.map((item) => item.id));
    expect(page.buttons.peak.attributes["aria-pressed"]).toBe("true");
    expect(page.buttons.found.attributes["aria-pressed"]).toBe("true");
    expect(page.buttons.all.attributes["aria-pressed"]).toBe("false");
    page.click("fartleks");
    expect(page.fartlekIds()).toEqual(fartleks.map((item) => item.id));
    page.click("found");
    expect(page.collectibleIds()).toEqual(["peak-unfound"]);
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
    const viewportStats = { totalCollectibles: 1, discoveredCount: 0, remainingCount: 1 };
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
    page.callbacks.onCollectibleSelect("castle-found");
    expect(page.detail.hidden).toBe(false);
    page.click("found");
    page.click("peak");
    expect(page.detail.innerHTML).toContain("Castle");
    expect(page.collectibleFeature("castle-found").properties.selected).toBe(true);
    page.click("found");
    expect(page.detail.hidden).toBe(true);
    expect(page.detail.innerHTML).toBe("");
    page.click("fartleks");
    page.callbacks.onFartlekSelect("fartlek-1");
    expect(page.detail.innerHTML).toContain("Harbour Straight");
    page.click("peak");
    expect(page.detail.hidden).toBe(false);
    page.click("fartleks");
    expect(page.detail.hidden).toBe(false);
    page.click("castle");
    expect(page.detail.hidden).toBe(true);
  });

  it("highlights a started exploration's targets, includes filtered targets, and frames them with its route", async () => {
    const page = await mount({ instances: [activeInstance] });
    page.click("peak");
    page.questSelectButton.handlers.click();

    await vi.waitFor(() => expect(page.map.fitTo).toHaveBeenCalled());
    expect(page.calls("/api/world/quest-targets?collectibleId=viewpoint-found&flowlineId=fartlek-1")).toHaveLength(1);
    expect(page.collectibleFeature("viewpoint-found").properties).toMatchObject({ questTarget: true, questRelated: true });
    expect(page.collectibleFeature("peak-unfound").properties.questRelated).toBe(false);
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
    expect(page.collectibleIds()).toEqual(["peak-unfound"]);
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

  it("explores the visible area by revealing Flowlines only, then summarizes the discovery", async () => {
    const page = await mount();
    expect(page.fartlekIds()).toEqual(["fartlek-1", "fartlek-2"]);
    page.explore();
    expect(page.exploreCard.innerHTML).toContain("Exploring this area\u2026");
    expect(page.cta.innerHTML).toMatch(/data-world-explore="explore" disabled/);
    await vi.waitFor(() => expect(page.exploreCard.innerHTML).toContain("2 Flowlines discovered"));
    expect(JSON.parse(page.calls("/api/world/explore", "POST")[0][1].body)).toEqual({ bbox: "8.00000,49.00000,11.00000,52.00000" });
    expect(page.exploreCard.innerHTML).toMatch(/<strong>1<\/strong> <span>high-flow<\/span>/);
    expect(page.exploreCard.innerHTML).toMatch(/<strong>1<\/strong> <span>endurance<\/span>/);
    expect(page.exploreCard.innerHTML).not.toContain("exploration</span>");
    expect(page.exploreCard.innerHTML).toContain("View discoveries");
    expect(page.exploreCard.innerHTML).toContain("Plan a route");
    expect(page.fartlekIds()).toEqual(["fartlek-1", "fartlek-2", "fresh-1", "fresh-2"]);
    expect(page.cta.innerHTML).toContain(">Show Flowlines<");
    expect(page.fetchMock.mock.calls.some(([url]) => url.startsWith("/api/explorations"))).toBe(false);
    expect(page.map.setRoute).not.toHaveBeenCalledWith(expect.objectContaining({ geometry: expect.anything() }));
    page.exploreCard.bound["[data-explore-close]:click"]();
    expect(page.exploreCard.hidden).toBe(true);
    expect(page.fartlekIds()).toContain("fresh-1");
  });

  it("labels the CTA from the area status and shows known Flowlines instead of re-discovering them", async () => {
    const partly = await mount({ areaStatus: { exploreAllowed: true, knownFlowlines: 3, availableFlowlines: 2 } });
    expect(partly.cta.innerHTML).toContain(">Explore for new Flowlines<");
    const zoomedOut = await mount({ areaStatus: { exploreAllowed: false, knownFlowlines: 0, availableFlowlines: 0 } });
    expect(zoomedOut.cta.innerHTML).toContain("Zoom in to explore");
    zoomedOut.explore();
    expect(zoomedOut.calls("/api/world/explore")).toHaveLength(0);

    const known = await mount({ areaStatus: { exploreAllowed: true, knownFlowlines: 2, availableFlowlines: 0 } });
    known.explore();
    expect(known.calls("/api/world/explore")).toHaveLength(0);
    expect(known.detail.innerHTML).toContain("Discovered in this area");
    expect(known.map.fitTo).toHaveBeenCalled();
  });

  it("encourages a wider search when nothing new was discovered", async () => {
    const page = await mount({ exploreResult: { outcome: "nothing_new", revealed: [], knownCount: 0, availableCount: 0, summary: { total: 0, byCharacter: {} } } });
    page.explore();
    await vi.waitFor(() => expect(page.exploreCard.innerHTML).toContain("Nothing new discovered here"));
    expect(page.exploreCard.innerHTML).toContain("Try exploring a wider area or another region.");
    expect(page.exploreCard.innerHTML).not.toContain("No Flowlines found");
    expect(page.collectibleIds()).toEqual(collectibles.map((item) => item.id));
    page.card("[data-explore-zoom-out]");
    expect(page.map.flyTo).toHaveBeenCalledWith(9.5, 50.5, 6);
  });

  it("offers the known Flowlines when the area was already explored", async () => {
    const page = await mount({ exploreResult: { outcome: "already_explored", revealed: [], knownCount: 7, availableCount: 0, summary: { total: 0, byCharacter: {} } } });
    page.explore();
    await vi.waitFor(() => expect(page.exploreCard.innerHTML).toContain("Area already explored"));
    expect(page.exploreCard.innerHTML).toContain("7 Flowlines known");
    page.card("[data-explore-show-known]");
    expect(page.detail.innerHTML).toContain("Discovered in this area");
    expect(page.exploreCard.hidden).toBe(true);
  });

  it("lists discoveries by tab and adds Flowlines to the route draft", async () => {
    const page = await mount();
    page.explore();
    await vi.waitFor(() => expect(page.exploreCard.innerHTML).toContain("View discoveries"));
    page.card("[data-explore-discoveries]");
    expect(page.detail.innerHTML).toContain("Discovered in this area");
    expect(page.detail.innerHTML).toContain('data-discoveries-sort="flow" aria-pressed="true"');
    expect(page.detail.innerHTML.indexOf("Rheintal Flowline")).toBeLessThan(page.detail.innerHTML.indexOf("Long Valley"));
    page.setDataset("[data-discoveries-sort]", { discoveriesSort: "endurance" });
    page.bound("[data-discoveries-sort]:click")();
    expect(page.detail.innerHTML.indexOf("Long Valley")).toBeLessThan(page.detail.innerHTML.indexOf("Rheintal Flowline"));

    page.setDataset("[data-discovery-view]", { discoveryView: "fresh-1" });
    page.setDataset("[data-flowline-add-route]", { flowlineAddRoute: "fresh-1" });
    page.bound("[data-discoveries-sort]:click")();
    page.bound("[data-discovery-view]:click")();
    expect(page.map.fitTo).toHaveBeenLastCalledWith([{ latitude: 49, longitude: 8 }, { latitude: 49.01, longitude: 8.01 }]);
    expect(page.fartlekFeature("fresh-1").properties.selected).toBe(true);
    page.bound("[data-flowline-add-route]:click")();
    expect(page.detail.innerHTML).toContain('data-flowline-add-route="fresh-1" aria-pressed="true"');
    expect(page.cta.innerHTML).toContain("Plan route \u00b7 1");
  });

  it("shows a Flowline card with its primary character and plans a route that includes it", async () => {
    const page = await mount({ savedHome: { latitude: 50, longitude: 9 } });
    page.callbacks.onFartlekSelect("fartlek-1");
    expect(page.detail.innerHTML).toContain("Unridden");
    expect(page.detail.innerHTML).toContain("Add to route");
    expect(page.detail.innerHTML).toContain("View details");
    await page.route();
    const body = JSON.parse(page.calls("/api/explorations/plan", "POST")[0][1].body);
    expect(body).toMatchObject({
      start: { lat: 50, lon: 9 },
      routeType: "round_trip",
      keepOrder: false,
      stops: [{ kind: "flowline", id: "fartlek-1" }]
    });
    expect(body.area.bbox.split(",").map(Number)).toHaveLength(4);
    expect(page.map.setRoute).toHaveBeenLastCalledWith({ geometry: routeGeometry });
    expect(page.fartlekFeature("fartlek-1").properties.questTarget).toBe(true);
    expect(page.cta.hidden).toBe(true);
    expect(page.calls("/api/explorations/generate")).toHaveLength(0);
  });

  it("adds collectibles and waypoints only in their add mode and keeps a reordered sequence", async () => {
    const page = await mount({ savedHome: { latitude: 50, longitude: 9 } });
    page.openPlanner();
    expect(page.detail.innerHTML).toContain("Plan a route");
    expect(page.detail.innerHTML).toMatch(/data-planner-route disabled/);
    page.callbacks.onCollectibleSelect("peak-unfound");
    expect(page.detail.innerHTML).not.toContain('data-planner-stop="peak-unfound"');

    page.setDataset("[data-planner-add]", { plannerAdd: "collectible" });
    page.bound("[data-planner-add]:click")();
    page.callbacks.onCollectibleSelect("peak-unfound");
    expect(page.detail.innerHTML).toContain('data-planner-stop="peak-unfound"');
    expect(page.collectibleFeature("peak-unfound").properties.questTarget).toBe(true);

    page.setDataset("[data-planner-add]", { plannerAdd: "waypoint" });
    page.bound("[data-planner-add]:click")();
    page.map.setMapClickHandler.mock.lastCall[0]({ lat: 50.3, lon: 9.3 });
    expect(page.detail.innerHTML).toContain('data-planner-stop="waypoint:50.300000,9.300000"');

    page.setDataset("[data-planner-move]", { plannerMove: "1:-1" });
    page.bound("[data-planner-move]:click")();
    expect(page.detail.innerHTML).toContain("Your order is kept.");
    page.bound("[data-planner-route]:click")();
    await vi.waitFor(() => expect(page.calls("/api/explorations/plan", "POST")).toHaveLength(1));
    expect(JSON.parse(page.calls("/api/explorations/plan", "POST")[0][1].body)).toMatchObject({
      keepOrder: true,
      stops: [{ kind: "waypoint", lat: 50.3, lon: 9.3 }, { kind: "collectible", id: "peak-unfound" }]
    });
  });

  it("asks for a start before routing and offers an optional suggested route", async () => {
    const page = await mount();
    page.openPlanner();
    expect(page.detail.innerHTML).toContain("Click the map to set your start.");
    page.map.setPickHandler.mock.lastCall[0]({ lat: 50, lon: 9 });
    expect(page.map.setRouteEndpoints).toHaveBeenLastCalledWith({ start: { lat: 50, lon: 9 }, end: undefined });
    page.bound("[data-planner-suggest]:click")();
    await vi.waitFor(() => expect(page.detail.innerHTML).toContain('data-planner-stop="peak-unfound"'));
    expect(JSON.parse(page.calls("/api/explorations/generate", "POST")[0][1].body)).toMatchObject({ start: { lat: 50, lon: 9 }, routeType: "round_trip" });
    expect(page.detail.innerHTML).toContain("data-planner-confirm");
  });

  it("keeps the stops and explains a failed route", async () => {
    const page = await mount({ savedHome: { latitude: 50, longitude: 9 }, planError: { error: "No suitable route was found.", code: "no_route" } });
    page.setDataset("[data-flowline-add-route]", { flowlineAddRoute: "fartlek-1" });
    page.callbacks.onFartlekSelect("fartlek-1");
    page.bound("[data-flowline-add-route]:click")();
    page.openPlanner();
    page.bound("[data-planner-route]:click")();
    await vi.waitFor(() => expect(page.detail.innerHTML).toContain("No suitable route was found."));
    expect(page.detail.innerHTML).toContain('data-planner-stop="flowline:fartlek-1"');
    expect(page.detail.innerHTML).not.toContain("data-planner-confirm");
  });

  it("closes the planner without persisting and keeps the picks as a draft", async () => {
    const page = await mount({ savedHome: { latitude: 50, longitude: 9 } });
    await page.route();
    const callsBefore = page.fetchMock.mock.calls.length;
    page.bound("[data-planner-close]:click")();
    expect(page.fetchMock.mock.calls.length).toBe(callsBefore);
    expect(page.detail.hidden).toBe(true);
    expect(page.cta.hidden).toBe(false);
    expect(page.cta.innerHTML).toContain("Plan route \u00b7 1");
    expect(page.map.setRoute).toHaveBeenLastCalledWith(undefined);
    expect(page.map.setRouteEndpoints).toHaveBeenLastCalledWith({});
  });

  it("starts exactly the routed plan as an exploration", async () => {
    const page = await mount({ savedHome: { latitude: 50, longitude: 9 } });
    await page.startExploration();
    expect(JSON.parse(page.calls("/api/explorations/confirm", "POST")[0][1].body)).toEqual({ proposalId: "proposal-plan" });
    expect(page.quests.innerHTML).toContain("Planned route");
    expect(page.detail.innerHTML).not.toContain("data-planner-confirm");
    expect(page.cta.innerHTML).toContain(">Plan route<");
    expect(page.map.setRoute).toHaveBeenLastCalledWith({ geometry: routeGeometry });
  });

  it("passes the last saved home into World map startup", async () => {
    const savedHome = { latitude: 50.2, longitude: 9.2 };
    const page = await mount({ savedHome });

    expect(page.callbacks.homePosition).toEqual(savedHome);
  });

  it("replaces the saved home after a successful Locate Me and recenters the map", async () => {
    const page = await mount({ savedHome: { latitude: 49.8, longitude: 8.8 } });
    const location = { latitude: 50.2, longitude: 9.2 };
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (success) => success({ coords: location })
      }
    });

    page.mountPoint.querySelector("[data-world-locate]").handlers.click();

    expect(page.savedHome()).toEqual(location);
    expect(page.localStorage.setItem).toHaveBeenCalledTimes(1);
    expect(page.map.setHomePosition).toHaveBeenCalledWith(location);
    expect(page.map.flyTo).toHaveBeenCalledWith(9.2, 50.2, worldMap.homeScaleZoom(50.2));
  });

  it("keeps the saved home when location permission is denied", async () => {
    const savedHome = { latitude: 50.2, longitude: 9.2 };
    const page = await mount({ savedHome });
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (_success, failure) => failure()
      }
    });

    page.mountPoint.querySelector("[data-world-locate]").handlers.click();

    expect(page.savedHome()).toEqual(savedHome);
    expect(page.localStorage.setItem).not.toHaveBeenCalled();
    expect(page.status.textContent).toContain("Location permission was denied");
  });

  it("confirms cancellation and deletes the started exploration", async () => {
    const page = await mount({ savedHome: { latitude: 50, longitude: 9 } });
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    await page.startExploration();
    page.questCancelButton.handlers.click();
    await vi.waitFor(() => expect(page.quests.innerHTML).toContain("Explore an area to reveal Flowlines"));
    expect(page.calls("/api/quest-instances/instance-1", "DELETE")).toHaveLength(1);
    expect(globalThis.confirm).toHaveBeenCalledWith("Cancel this exploration and delete its progress? This cannot be undone.");
    expect(page.map.setRoute).toHaveBeenLastCalledWith(undefined);
  });

  it("does not cancel an exploration when the user declines confirmation", async () => {
    const page = await mount({ savedHome: { latitude: 50, longitude: 9 } });
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    await page.startExploration();
    page.questCancelButton.handlers.click();
    expect(page.calls("/api/quest-instances/instance-1")).toHaveLength(0);
    expect(page.quests.innerHTML).toContain('aria-label="Cancel exploration"');
  });
});
