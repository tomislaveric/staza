import { describe, expect, it } from "vitest";
import { flowlinePolicyForBounds } from "./flowlinePolicy.js";

const boundsOfWidthKm = (km: number) => ({
  minLatitude: 0, maxLatitude: 0.1, minLongitude: 0, maxLongitude: km / 111.32
});

describe("flowline viewport policy", () => {
  it("shows everything up to a 100 km wide viewport", () => {
    expect(flowlinePolicyForBounds(boundsOfWidthKm(50), 500)).toEqual({ minLengthMeters: 0, limit: 500 });
    expect(flowlinePolicyForBounds(boundsOfWidthKm(100), 500)).toEqual({ minLengthMeters: 0, limit: 500 });
  });

  it("shows a shrinking share of longer Flowlines when wider", () => {
    const widths = [200, 500, 2000];
    const policies = widths.map((km) => flowlinePolicyForBounds(boundsOfWidthKm(km), 500));
    expect(policies[0].limit).toBe(250);
    for (let index = 1; index < policies.length; index += 1) {
      expect(policies[index].limit).toBeLessThan(policies[index - 1].limit);
      expect(policies[index].minLengthMeters).toBeGreaterThanOrEqual(policies[index - 1].minLengthMeters);
    }
    expect(policies[2].minLengthMeters).toBe(6_000);
  });

  it("accounts for longitude shrinking with latitude", () => {
    const wide = { minLatitude: 60, maxLatitude: 60.1, minLongitude: 0, maxLongitude: 1.7 };
    expect(flowlinePolicyForBounds(wide, 500).limit).toBe(500);
  });
});
