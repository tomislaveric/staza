import { describe, expect, it } from "vitest";
import { ExploreResultCard, exploreCta, revealSequence, sortDiscoveries } from "./explore-reveal.js";

describe("exploreCta", () => {
  it("is disabled only while the area is too wide to explore", () => {
    expect(exploreCta(false)).toMatchObject({ action: "zoom", disabled: true });
    expect(exploreCta(true)).toEqual({ action: "explore", label: "Explore this area" });
  });
});

describe("ExploreResultCard", () => {
  it("summarizes the session's opportunities and leads with Generate route", () => {
    const markup = ExploreResultCard({ phase: "result", result: {
      outcome: "discovered", flowlines: [], collectibles: [], availableCount: 0,
      summary: { total: 2, byCharacter: { explore: 2 }, collectibles: 3 }
    } });
    expect(markup).toContain("5 opportunities");
    expect(markup).toMatch(/<strong>2<\/strong> <span>exploration<\/span>/);
    expect(markup).toMatch(/<strong>3<\/strong> <span>collectibles<\/span>/);
    expect(markup).toMatch(/class="is-primary" data-explore-generate>Generate route/);
    expect(markup).toContain("data-explore-discoveries");
    expect(markup).not.toContain("already explored");
  });

  it("speaks of a single opportunity in the singular", () => {
    const markup = ExploreResultCard({ phase: "result", result: {
      outcome: "discovered", flowlines: [], collectibles: [], summary: { total: 1, byCharacter: { flow: 1 }, collectibles: 0 }
    } });
    expect(markup).toContain("1 opportunity");
  });

  it("offers to zoom out when the area has nothing to explore", () => {
    const markup = ExploreResultCard({ phase: "result", result: { outcome: "nothing_new", flowlines: [], collectibles: [] } });
    expect(markup).toContain("data-explore-zoom-out");
    expect(markup).not.toContain("data-explore-generate");
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
