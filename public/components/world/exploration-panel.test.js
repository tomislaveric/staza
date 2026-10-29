import { describe, expect, it } from "vitest";
import {
  activeProposal,
  buildGenerateRequest,
  createExplorationState,
  ExplorationPanel,
  findCatalogTarget,
  formatRouteDistance,
  formatRouteDuration,
  plannedRouteGpxUrl,
  plannedRouteSummary,
  routeTargetIds,
  targetSummaryText
} from "./exploration-panel.js";
import { endpointsToGeoJson } from "./world-map.js";

const area = { bbox: "8.00000,49.00000,11.00000,52.00000", center: { lat: 50.5, lon: 9.5 }, zoom: 9 };
const configured = (overrides = {}) => ({
  ...createExplorationState(area),
  picking: undefined,
  start: { lat: 50, lon: 9 },
  ...overrides
});
const proposal = (id, label, overrides = {}) => ({
  id,
  label,
  routeType: "round_trip",
  distanceM: 42_300,
  durationS: 5_400,
  elevationGainM: 412.4,
  geometry: { type: "LineString", coordinates: [[9, 50], [9.1, 50.1]] },
  start: { lat: 50, lon: 9 },
  end: { lat: 50, lon: 9 },
  includedTargetIds: ["c1", "c2"],
  nearbyTargetIds: [],
  targetSummary: { peaks: 0, places: 1, other: 0 },
  traversedFlowlines: [{ id: "f1", name: "River Line", lengthMeters: 900 }],
  recommended: false,
  constraintFit: "within",
  ...overrides
});
const catalog = {
  collectibles: [{ id: "c1", name: "Castle <One>", primaryCategory: "castle" }, { id: "c2", name: "Peak Two", primaryCategory: "mountain_pass" }, { id: "c3", name: "Hidden Pass", primaryCategory: "mountain_pass" }],
  flowlines: [{ id: "f1", name: "River Line" }]
};
const customizing = (overrides = {}) => configured({
  phase: "customize",
  explorationId: "exp-1",
  proposals: [
    proposal("p1", "quick", { includedTargetIds: ["c1"], traversedFlowlines: [] }),
    proposal("p2", "balanced", { recommended: true, hint: "discovery" }),
    proposal("p3", "adventure", { includedTargetIds: ["c1", "c2"], hint: "climb" })
  ],
  selectedProposalId: "p2",
  catalog,
  ...overrides
});

describe("exploration route formatting", () => {
  it("formats distance, duration, and target summaries", () => {
    expect(formatRouteDistance(42_300)).toBe("42.3 km");
    expect(formatRouteDistance(123_456)).toBe("123 km");
    expect(formatRouteDuration(5_400)).toBe("1h 30m");
    expect(formatRouteDuration(600)).toBe("10m");
    expect(targetSummaryText({ peaks: 1, places: 0, other: 1 }))
      .toBe("1 Peak · 1 other target");
    expect(plannedRouteSummary({ distanceM: 42_300, durationS: 5_400, routeType: "point_to_point" }))
      .toBe("42.3 km · 1h 30m · A to B");
  });
});

describe("buildGenerateRequest", () => {
  it("requires a start and, for A to B, a destination", () => {
    expect(buildGenerateRequest(createExplorationState(area)).error).toBe("Choose a start on the map.");
    expect(buildGenerateRequest(configured({ routeType: "point_to_point" })).error).toBe("Choose a destination on the map.");
  });

  it("validates ride length bounds", () => {
    expect(buildGenerateRequest(configured({ distanceKm: 1 })).error).toBe("Choose a distance between 2 and 300 km.");
    expect(buildGenerateRequest(configured({ distanceKm: Number.NaN })).error).toBe("Enter a ride distance or time.");
    expect(buildGenerateRequest(configured({ constraintType: "duration", durationMin: 800 })).error)
      .toBe("Choose a time between 10 minutes and 12 hours.");
  });

  it("sends the frozen area and the ride only, in meters and seconds", () => {
    expect(buildGenerateRequest(configured({ distanceKm: 42.5 })).body).toEqual({
      area,
      routeType: "round_trip",
      sport: "cycling",
      start: { lat: 50, lon: 9 },
      constraint: { type: "distance", value: 42_500 }
    });
    expect(buildGenerateRequest(configured({
      routeType: "point_to_point", end: { lat: 50.2, lon: 9.3 }, constraintType: "duration", durationMin: 90
    })).body).toEqual({
      area,
      routeType: "point_to_point",
      sport: "cycling",
      start: { lat: 50, lon: 9 },
      end: { lat: 50.2, lon: 9.3 },
      constraint: { type: "duration", value: 5_400 }
    });
  });
});

describe("ExplorationPanel configure step", () => {
  it("asks only for start, route type and ride length", () => {
    const markup = ExplorationPanel(createExplorationState(area));
    expect(markup).toContain("Explore this Area");
    expect(markup).toContain("Step 1");
    expect(markup).toContain("data-exploration-locate");
    expect(markup).toContain('data-exploration-pick="start" aria-pressed="true"');
    expect(markup).toContain("Click the map to set your start.");
    expect(markup).toContain('data-exploration-route-type="round_trip" aria-pressed="true"');
    expect(markup).toContain('data-exploration-preset="50" aria-pressed="true"');
    expect(markup).toContain("Generate Routes");
    expect(markup).toContain("data-exploration-cancel");
    for (const hidden of ["Included destinations", "Along this route", "data-exploration-remove", "data-exploration-add", "data-exploration-proposal", "Flowline", "data-exploration-confirm"]) {
      expect(markup).not.toContain(hidden);
    }
  });

  it("renders the destination row and time presets when configured", () => {
    const markup = ExplorationPanel(configured({ routeType: "point_to_point", constraintType: "duration" }));
    expect(markup).toContain('data-exploration-pick="end"');
    expect(markup).toContain('data-exploration-preset="120" aria-pressed="true"');
    expect(markup).toContain("Custom minutes");
  });

  it("locks the ride and offers Cancel while generating", () => {
    const markup = ExplorationPanel(configured({ phase: "generating" }));
    expect(markup).toContain("Finding routes for your ride...");
    expect(markup).toContain("data-exploration-stop");
    expect(markup).not.toContain("data-exploration-generate");
    expect(markup).toMatch(/data-exploration-preset="50" aria-pressed="true" disabled/);
    expect(markup).not.toContain("Included destinations");
  });

  it("shows errors as escaped alerts", () => {
    const markup = ExplorationPanel({ ...createExplorationState(area), error: "No route <found>" });
    expect(markup).toContain('role="alert">No route &lt;found&gt;');
  });
});

describe("ExplorationPanel route step", () => {
  it("shows Quick, Balanced and Adventure cards with composition hints, recommending one", () => {
    const markup = ExplorationPanel(customizing());
    expect(markup).toContain("Step 2");
    expect(markup).toContain("Round trip · 50 km");
    expect(markup).toContain("data-exploration-edit-ride");
    expect(markup).toContain("Quick");
    expect(markup).toContain("Balanced");
    expect(markup).toContain("Adventure");
    expect(markup).toContain("Recommended · Discovery");
    expect(markup).toContain("Climb");
    expect(markup).toContain("42.3 km");
    expect(markup).toContain("↑ 412 m");
    expect(markup).toContain("<span data-proposal-destinations>1 Place</span>");
    expect(markup).toContain("Along this route: 1 Flowline");
    expect(markup).toContain('data-exploration-proposal="p2" aria-pressed="true"');
    expect(markup).not.toContain("score");
    expect(markup).toMatch(/data-exploration-confirm>Start Exploration/);
  });

  it("lists destinations with remove controls and Flowlines separately under Along this route", () => {
    const markup = ExplorationPanel(customizing());
    expect(markup).toContain("Included destinations");
    expect(markup).toContain("Castle &lt;One&gt;");
    expect(markup).toContain("Peak Two");
    expect(markup).not.toContain("Hidden Pass");
    const [destinations, along] = markup.split('data-exploration-along');
    expect(destinations).not.toContain("River Line");
    expect(along).toContain("River Line");
    expect(along).not.toContain("data-exploration-remove");
    expect(markup).toContain("Along this route");
    expect(markup).toContain("collectible-swatch is-unvisited is-castle is-icon");
    expect(markup).toContain('class="fartlek-swatch" aria-hidden="true"');
    expect(markup).not.toContain("<small>Castle</small>");
    expect(markup).toMatch(/data-exploration-remove="c1"\s+aria-label="Remove Castle &lt;One&gt; from this route">/);
    expect(markup).toMatch(/data-exploration-add aria-pressed="false">\s*Add destination/);
    expect(markup).not.toContain("data-exploration-reset");

    const single = ExplorationPanel(customizing({ selectedProposalId: "p1" }));
    expect(single).toMatch(/data-exploration-remove="c1"\s+aria-label="[^"]+" disabled/);
    expect(ExplorationPanel(customizing({ adding: true }))).toContain("Select a target on the map to add it to this route.");
  });

  it("shows the customized version with its warnings, dropped targets and Reset", () => {
    const edited = proposal("p2-custom", "balanced", {
      recommended: true, customized: true, basedOn: "p2", includedTargetIds: ["c1", "c2"],
      constraintFit: "long", droppedTargetIds: ["c3"], distanceM: 61_000, traversedFlowlines: []
    });
    const markup = ExplorationPanel(customizing({ customizedById: { p2: edited } }));
    expect(markup).toContain("Customized");
    expect(markup).toContain("61.0 km");
    expect(markup).toContain("Peak Two");
    expect(markup).toContain("This route is longer than your planned ride.");
    expect(markup).toContain("Couldn't route to Hidden Pass, so it was left out.");
    expect(markup).toContain("data-exploration-reset");
    expect(ExplorationPanel(customizing({ customizedById: { p2: { ...edited, constraintFit: "short", droppedTargetIds: [] } } })))
      .toContain("This route is shorter than your planned ride.");
  });

  it("disables edits and confirmation while a route is updating or starting", () => {
    const rerouting = ExplorationPanel(customizing({ status: "rerouting", pendingTargetIds: ["c1"] }));
    expect(rerouting).toContain("Updating route...");
    expect(rerouting).toContain("is-updating");
    expect(rerouting).not.toContain("River Line");
    expect(rerouting).toMatch(/data-exploration-confirm disabled/);
    expect(rerouting).toMatch(/data-exploration-add aria-pressed="false" disabled/);
    expect(ExplorationPanel(customizing({ phase: "confirming" }))).toMatch(/data-exploration-confirm disabled/);
  });

  it("blocks adding beyond the route target limit", () => {
    const markup = ExplorationPanel(customizing({ limits: { maxRouteTargets: 2 } }));
    expect(markup).toMatch(/data-exploration-add aria-pressed="false" disabled/);
    expect(markup).toContain("A route can include at most 2 destinations.");
  });
});

describe("exploration helpers", () => {
  it("resolves the active version and contents of a proposal", () => {
    const state = customizing({ customizedById: { p2: proposal("p2-custom", "balanced", { includedTargetIds: ["c2"], nearbyTargetIds: ["c1", "c2"] }) } });
    expect(activeProposal(state).id).toBe("p2-custom");
    expect(activeProposal(state, "p1").id).toBe("p1");
    expect(activeProposal({ ...state, selectedProposalId: undefined })).toBeUndefined();
    expect(routeTargetIds(activeProposal(state))).toEqual(["c2", "c1"]);
  });

  it("finds catalog targets by id", () => {
    expect(findCatalogTarget(catalog, "f1")).toBeUndefined();
    expect(findCatalogTarget(catalog, "c2")).toEqual({
      category: "mountain_pass", id: "c2", name: "Peak Two", visited: false
    });
    expect(findCatalogTarget(catalog, "missing")).toBeUndefined();
  });
});

describe("endpointsToGeoJson", () => {
  it("emits start and distinct destination markers", () => {
    expect(endpointsToGeoJson().features).toEqual([]);
    expect(endpointsToGeoJson({ start: { lat: 50, lon: 9 }, end: { lat: 50, lon: 9 } }).features).toHaveLength(1);
    expect(endpointsToGeoJson({ start: { lat: 50, lon: 9 }, end: { lat: 51, lon: 10 } }).features)
      .toEqual([
        { type: "Feature", properties: { kind: "start" }, geometry: { type: "Point", coordinates: [9, 50] } },
        { type: "Feature", properties: { kind: "end" }, geometry: { type: "Point", coordinates: [10, 51] } }
      ]);
  });
});

describe("sport choice, warnings and export", () => {
  it("lets the player choose a sport with sport-specific copy and sends it", () => {
    const markup = ExplorationPanel(configured({ sport: "running" }));
    expect(markup).not.toContain("Describe your ride");
    expect(markup).toContain('data-exploration-sport="running" aria-pressed="true"');
    expect(markup).toContain('data-exploration-sport="hiking" aria-pressed="false"');
    expect(ExplorationPanel(configured({ sport: "hiking", phase: "generating" }))).toContain("Finding routes for your hike...");
    expect(buildGenerateRequest(configured({ sport: "hiking" })).body.sport).toBe("hiking");
    expect(ExplorationPanel(customizing({ sport: "running", customizedById: { p2: proposal("p2-c", "balanced", { constraintFit: "short" }) } })))
      .toContain("shorter than your planned run.");
  });

  it("shows the insufficient-area warning from the API", () => {
    const warnings = [{ code: "insufficient_area", message: "This area can't support a 50 km route <now>." }];
    const markup = ExplorationPanel(customizing({ warnings }));
    expect(markup).toContain('data-exploration-warning="insufficient_area"');
    expect(markup).toContain("support a 50 km route &lt;now&gt;.");
  });

  it("links the GPX download for a planned route", () => {
    expect(plannedRouteGpxUrl("0b8f1c1e")).toBe("/api/quest-instances/0b8f1c1e/planned-route.gpx");
  });
});
