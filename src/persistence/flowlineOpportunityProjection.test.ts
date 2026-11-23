import { describe, expect, it, vi } from "vitest";
import { FlowlineRevealRepository } from "./flowlineRevealRepository.js";
import { classifyFlowline } from "../flowlineCharacter.js";

describe("opportunity length projection without a database", () => {
  it("fetches length alongside scores without geometry for consistent character decisions", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ id: "long", length_meters: 5000, flow_score: 90, suitability_score: 90,
        endurance_score: 65, explore_score: 100, road_quality_score: 85, data_confidence: 90 }]
    });
    const repository = new FlowlineRevealRepository({ query });
    const rows = await repository.listOpportunityCandidatesWithinBounds("player", {
      minLatitude: 47, maxLatitude: 48, minLongitude: 8, maxLongitude: 9
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("f.length_meters"), ["player", 8, 9, 47, 48]);
    expect(rows[0]).toMatchObject({ lengthMeters: 5000, flowScore: 90, enduranceScore: 65 });
    expect(rows[0]).not.toHaveProperty("geometry");
    expect(classifyFlowline(rows[0]).primary).toBe("endurance");
  });
});
