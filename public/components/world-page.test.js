import { describe, expect, it } from "vitest";
import { filteredWorldCollectibles, filteredWorldFartleks, mappedWorldCollectibles, visibleWorldCollectibles, worldFilters } from "./world-page.js";
import * as worldMarkers from "./world/world-markers.js";
import * as worldMap from "./world/world-map.js";

const collectibles = [
  { id: "common-found", found: true, rarity: "common", latitude: 49, longitude: 8 },
  { id: "rare-unfound", found: false, rarity: "rare", latitude: 50, longitude: 9 },
  { id: "epic-found", found: true, rarity: "epic", latitude: 51, longitude: 10 }
];

const fartleks = [
  { id: "fartlek-1", name: "Harbour Straight", completed: false },
  { id: "fartlek-2", name: "River Run", completed: true }
];

describe("World page data transformations", () => {
  it("keeps rarity filters independent from player discovery state", () => {
    expect(filteredWorldCollectibles(collectibles, "found").map((item) => item.id)).toEqual(["common-found", "epic-found"]);
    expect(filteredWorldCollectibles(collectibles, "unfound").map((item) => item.id)).toEqual(["rare-unfound"]);
    expect(filteredWorldCollectibles(collectibles, "rare").map((item) => item.id)).toEqual(["rare-unfound"]);
    expect(filteredWorldCollectibles(collectibles, "epic").map((item) => item.id)).toEqual(["epic-found"]);
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
    expect(filteredWorldCollectibles(withHidden, "epic").map((item) => item.id)).toEqual(["epic-found"]);
  });
});

describe("Fartlek filtering", () => {
  it("exposes a Fartleks tab alongside the existing collectible filters", () => {
    expect(worldFilters).toContain("fartleks");
  });

  it("hides collectibles entirely under the Fartleks filter", () => {
    expect(filteredWorldCollectibles(collectibles, "fartleks")).toEqual([]);
  });

  it("hides Fartleks under collectible-only filters, leaving them visible otherwise", () => {
    expect(filteredWorldFartleks(fartleks, "found")).toEqual([]);
    expect(filteredWorldFartleks(fartleks, "unfound")).toEqual([]);
    expect(filteredWorldFartleks(fartleks, "rare")).toEqual([]);
    expect(filteredWorldFartleks(fartleks, "epic")).toEqual([]);
    expect(filteredWorldFartleks(fartleks, "all")).toEqual(fartleks);
    expect(filteredWorldFartleks(fartleks, "fartleks")).toEqual(fartleks);
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

    expect(mappedWorldCollectibles([...collectibles, hidden], "all").map((item) => item.id))
      .toEqual(["common-found", "rare-unfound", "epic-found"]);
  });
});
