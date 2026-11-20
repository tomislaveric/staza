import { describe, expect, it } from "vitest";
import { ExploreResultCard, exploreCta, revealSequence, sortDiscoveries } from "./explore-reveal.js";

describe("exploreCta", () => {
  it("is disabled only while the area is too wide to explore", () => {
    expect(exploreCta(false)).toMatchObject({ action: "zoom", disabled: true });
    expect(exploreCta(true)).toEqual({ action: "explore", label: "Explore this area" });
  });
});

describe("ExploreResultCard", () => {
  it("separates known Flowlines from the newly revealed ones when an explored area has new opportunities", () => {
    const markup = ExploreResultCard({ phase: "result", result: {
      outcome: "already_explored_new", revealed: [], knownCount: 9, availableCount: 0,
      summary: { total: 2, byCharacter: { explore: 2 } }
    } });
    expect(markup).toContain("Area already explored");
    expect(markup).toContain("2 Flowlines discovered");
    expect(markup).toContain("7 Flowlines known \u00b7 2 new opportunities");
    expect(markup).toMatch(/<strong>2<\/strong> <span>exploration<\/span>/);
  });

  it("speaks of a single discovery in the singular", () => {
    const markup = ExploreResultCard({ phase: "result", result: {
      outcome: "discovered", revealed: [], knownCount: 1, availableCount: 0, summary: { total: 1, byCharacter: { flow: 1 } }
    } });
    expect(markup).toContain("1 Flowline discovered");
  });
});

describe("sortDiscoveries", () => {
  const flowlines = [
    { id: "a", name: "A", completed: true, flowScore: 90, enduranceScore: 10, geometry: { coordinates: [[9, 50]] } },
    { id: "b", name: "B", completed: false, flowScore: 50, enduranceScore: 80, geometry: { coordinates: [[8, 49]] } },
    { id: "c", name: "C", completed: false, flowScore: 70, geometry: { coordinates: [[8.5, 49.5]] } }
  ];
  const ids = (sort, origin) => sortDiscoveries(flowlines, sort, origin).map((flowline) => flowline.id);

  it("orders each tab by its own relevance", () => {
    expect(ids("flow")).toEqual(["a", "c", "b"]);
    expect(ids("endurance")).toEqual(["b", "a", "c"]);
    expect(ids("unridden")).toEqual(["c", "b", "a"]);
    expect(ids("nearby", { latitude: 49, longitude: 8 })).toEqual(["b", "c", "a"]);
  });
});

describe("revealSequence", () => {
  it("staggers new Flowlines subtly and shows them at once with reduced motion", () => {
    const flowlines = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(revealSequence(flowlines, { stepMs: 100 }).map((step) => step.delayMs)).toEqual([0, 100, 200]);
    expect(revealSequence(flowlines, { reducedMotion: true }).every((step) => step.delayMs === 0)).toBe(true);
  });
});
