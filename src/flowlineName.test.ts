import { describe, expect, it } from "vitest";
import { readableFlowlineName } from "./flowlineName.js";

describe("readableFlowlineName", () => {
  it("cleans raw OSM names and falls back when data is incomplete", () => {
    expect(readableFlowlineName("Hayna -> Hayna")).toBe("Around Hayna");
    expect(readableFlowlineName("Gochsheim -> ?")).toBe("Leaving Gochsheim");
    expect(readableFlowlineName("? -> Grafenrheinfeld")).toBe("Towards Grafenrheinfeld");
    expect(readableFlowlineName("Hayna -> Gochsheim")).toBe("Hayna \u2192 Gochsheim");
    expect(readableFlowlineName("B 35;B 293")).toBe("B 35 / B 293");
    expect(readableFlowlineName("? -> ?")).toBe("Unnamed Flowline");
    expect(readableFlowlineName(undefined)).toBe("Unnamed Flowline");
    expect(readableFlowlineName("  ")).toBe("Unnamed Flowline");
  });
});
