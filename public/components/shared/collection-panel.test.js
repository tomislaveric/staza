import { describe, expect, it } from "vitest";
import {
  CollectionPanel,
  CollectionRow,
  collectionStateLabel
} from "./collection-panel.js";

describe("collection panel vocabulary", () => {
  it("labels each row state in the completed wording", () => {
    expect(collectionStateLabel("completed")).toBe("Completed");
    expect(collectionStateLabel("nearby-miss")).toBe("Nearby miss");
    expect(collectionStateLabel("unvisited")).toBe("Unvisited");
  });

});

describe("collection rows", () => {
  it("renders an interactive, markable row for the World map", () => {
    const row = CollectionRow({ id: "castle-7", name: "Castle", state: "completed", interactive: true });
    expect(row).toContain('data-world-marker="castle-7"');
    expect(row).toContain("is-found");
    expect(row).toContain("Completed");
  });

  it("renders a static, trackable row for the replay overlay", () => {
    const row = CollectionRow({ id: "coin-1", name: "Coin", state: "nearby-miss" });
    expect(row).toContain('data-collection-row="coin-1"');
    expect(row).not.toContain("data-world-marker");
    expect(row).toContain("Nearby miss");
  });
});

describe("collection panel", () => {
  const rows = [
    { id: "a", name: "Alpha", state: "completed" },
    { id: "b", name: "Bravo", state: "nearby-miss" }
  ];

  it("shows a creator attribution when provided", () => {
    const markup = CollectionPanel({
      title: "Ridge Loop",
      creator: "Ada",
      description: "A loop",
      closable: true,
      rows
    });
    expect(markup).toContain("Ridge Loop");
    expect(markup).toContain("by Ada");
    expect(markup).toContain("A loop");
    expect(markup).toContain("Nearby miss");
    expect(markup).toContain("data-world-close");
  });

  it("hides the creator attribution and close affordance on the ActivityDetail overlay", () => {
    const markup = CollectionPanel({ title: "Ride", rows });
    expect(markup).not.toContain("<small>by ");
    expect(markup).not.toContain("data-world-close");
    expect(markup).toContain("Ride");
  });

  it("escapes a FIT-provided title", () => {
    const markup = CollectionPanel({ title: '<img src=x onerror="alert(1)">', rows: [] });
    expect(markup).not.toContain("<img src=x");
    expect(markup).toContain("&lt;img");
  });
});
