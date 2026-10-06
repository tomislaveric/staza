import { describe, expect, it } from "vitest";
import { AddActivityPage, PROCESSING_STEP_DURATION_MS } from "./add-activity-page.js";
import { ProcessingState, processingSteps } from "./processing-state.js";

describe("AddActivityPage", () => {
  it("renders only the accessible required FIT upload control", () => {
    const page = AddActivityPage();
    expect(page).toContain('name="fit"');
    expect(page).toContain("required");
    expect(page).toContain("Drop file here or click");
    expect(page).toContain(".fit files supported");
    expect(page).toContain("PROCESS ACTIVITY");
    expect(page).not.toContain('name="video"');
    expect(page).not.toContain("Add video (optional)");
  });

  it("renders factual persisted activity completion", () => {
    const page = AddActivityPage({
      complete: { id: "activity-1", collectedCount: 2, xpEarned: 75 }
    });
    expect(page).toContain("Activity Ready");
    expect(page).toContain("2 collectibles found along your route");
    expect(page).toContain("+75 XP");
    expect(page).toContain('class="upload-status-xp"');
    expect(page).toContain("VIEW ACTIVITY");
  });

  it("keeps an optional video failure separate from successful activity import", () => {
    const page = AddActivityPage({
      complete: { id: "activity-1", collectedCount: 0, xpEarned: 0 },
      error: "No GPS5 track was found."
    });
    expect(page).toContain("Activity Ready");
    expect(page).toContain("Your activity was saved, but video processing could not start");
  });
});

describe("ProcessingState", () => {
  it("holds each visible processing stage for one second", () => {
    expect(PROCESSING_STEP_DURATION_MS).toBe(1_000);
  });

  it("renders the Figma processing checklist with completed, active, and pending stages", () => {
    const page = ProcessingState({ step: 2 });
    expect(processingSteps).toEqual([
      "Reading GPS route",
      "Matching collectibles",
      "Calculating XP",
      "Building replay"
    ]);
    expect(page).toContain("Processing Activity");
    expect(page).toContain("Discovering collectibles along your route");
    expect(page.match(/is-complete/g)).toHaveLength(2);
    expect(page.match(/is-active/g)).toHaveLength(1);
    expect(page.match(/is-pending/g)).toHaveLength(1);
    expect(page).toContain("/assets/add-activity-processing.svg");
    expect(page).toContain("/assets/add-activity-processing-check.svg");
  });
});
