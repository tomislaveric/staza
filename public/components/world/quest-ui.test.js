import { describe, expect, it } from "vitest";
import { formatProgressPercent, questProgressLabel, QuestCard, QuestList, QuestStatusBadge } from "./quest-list.js";
import { CreateRouteCta, QuestDetail } from "./quest-detail.js";
import { buildQuestPayload, initialEditorState } from "./quest-editor.js";
import { markerLabel, WorldLegend } from "./world-markers.js";
import { QuestCollectibleRow } from "./quest-detail.js";
import { CollectibleSwatch } from "./collectible-swatch.js";

const progress = (collected, total) => ({
  collected,
  total,
  ratio: total === 0 ? 0 : collected / total,
  complete: total > 0 && collected === total
});

const quest = (overrides = {}) => ({
  id: "quest-1",
  title: "Best Viewpoints around Karlsruhe",
  description: "Ridge loop",
  status: "published",
  createdBy: "Ada",
  isOwner: false,
  centerLatitude: 49,
  centerLongitude: 8.4,
  collectibleCount: 8,
  hasRoute: true,
  progress: progress(4, 8),
  collectibles: [],
  ...overrides
});

describe("quest progress presentation", () => {
  it("renders progress as a visited count and a percentage", () => {
    expect(questProgressLabel(progress(4, 8))).toBe("4 / 8 completed");
    expect(formatProgressPercent(progress(4, 8))).toBe("50%");
  });

  it("never divides by zero for a quest without collectibles", () => {
    expect(questProgressLabel(progress(0, 0))).toBe("No collectibles yet");
    expect(formatProgressPercent(progress(0, 0))).toBe("0%");
  });

  it("shows a draft badge for drafts and a complete badge only when finished", () => {
    expect(QuestStatusBadge(quest({ status: "draft" }))).toContain("Draft");
    expect(QuestStatusBadge(quest({ progress: progress(8, 8) }))).toContain("Complete");
    expect(QuestStatusBadge(quest())).toBe("");
  });

  it("escapes creator-controlled quest text", () => {
    const card = QuestCard(quest({ title: '<img src=x onerror="alert(1)">' }), undefined);
    expect(card).not.toContain("<img src=x");
    expect(card).toContain("&lt;img");
  });
});

describe("quests nearby list", () => {
  it("shows an empty state instead of fabricating quests", () => {
    const markup = QuestList([], undefined);
    expect(markup).toContain("Nothing curated here yet.");
    expect(markup).not.toContain("quest-card");
  });

  it("marks the selected quest", () => {
    expect(QuestList([quest()], "quest-1")).toContain("is-selected");
    expect(QuestList([quest()], "other")).not.toContain("is-selected");
  });
});

describe("create route CTA", () => {
  it("renders a Coming Soon placeholder button", () => {
    const cta = CreateRouteCta();
    expect(cta).toContain("CREATE ROUTE");
    expect(cta).toContain("data-coming-soon");
    expect(cta).toContain("Coming soon");
  });

  it("does not navigate to any external location", () => {
    const cta = CreateRouteCta();
    expect(cta).not.toContain("href");
    expect(cta).toContain("<button");
  });
});

describe("quest detail", () => {
  const detailQuest = quest({
    collectibles: [
      { id: "a", name: "Turmberg", type: "landmark", rarity: "epic", value: 50, found: true },
      { id: "b", name: "Rheinbrücke", type: "coin", value: 10, found: false }
    ]
  });

  it("renders the Create route Coming Soon button", () => {
    expect(QuestDetail(detailQuest)).toContain("CREATE ROUTE");
    expect(QuestDetail(detailQuest)).toContain("data-coming-soon");
  });

  it("shows per-collectible completed state and subtle creator attribution", () => {
    const markup = QuestDetail(detailQuest);
    expect(markup).toContain("Completed");
    expect(markup).toContain("Unvisited");
    expect(markup).toContain("by Ada");
    expect(markup).toContain("4 / 8 completed");
  });

  it("offers owner actions only to the creator", () => {
    expect(QuestDetail(detailQuest)).not.toContain("data-quest-edit");
    const owned = QuestDetail(quest({ isOwner: true, status: "draft", collectibles: [] }));
    expect(owned).toContain("data-quest-edit");
    expect(owned).toContain("PUBLISH");
  });

  it("offers unpublishing for a published quest owned by the player", () => {
    expect(QuestDetail(quest({ isOwner: true, status: "published" }))).toContain("UNPUBLISH");
  });
});

describe("quest editor state", () => {
  const collectibles = [
    { id: "a", name: "A", type: "coin", value: 10, found: true },
    { id: "b", name: "B", type: "coin", value: 10, found: false }
  ];

  it("preselects the suggested collectibles of an activity draft", () => {
    const state = initialEditorState({ draft: { title: "Ride", collectibles, sourceActivityId: "activity-1" } });
    expect(state.mode).toBe("create");
    expect(state.selectedIds).toEqual(["a", "b"]);
    expect(state.sourceActivityId).toBe("activity-1");
  });

  it("keeps the source activity reference and selected subset in the payload", () => {
    const state = initialEditorState({ draft: { title: "Ride", collectibles, sourceActivityId: "activity-1" } });
    state.selectedIds = ["b"];
    expect(buildQuestPayload(state)).toEqual({
      title: "Ride",
      description: "",
      collectibleIds: ["b"],
      sourceActivityId: "activity-1"
    });
  });

  it("loads an existing quest for editing without a source activity", () => {
    const state = initialEditorState({
      quest: quest({ isOwner: true, status: "draft", collectibles })
    });
    expect(state.mode).toBe("edit");
    expect(state.questId).toBe("quest-1");
    expect(buildQuestPayload(state).sourceActivityId).toBeUndefined();
  });
});

describe("world markers", () => {
  it("labels collectibles with visited state for assistive technology", () => {
    expect(markerLabel({ name: "Turmberg", found: true, rarity: "epic" })).toBe("Turmberg, visited, epic");
    expect(markerLabel({ name: "Turmberg", found: false })).toBe("Turmberg, unvisited");
  });
});

describe("shared marker vocabulary", () => {
  it("encodes discovery and rarity in one swatch", () => {
    expect(CollectibleSwatch({ visited: true })).toContain("is-visited");
    expect(CollectibleSwatch({ visited: false })).toContain("is-unvisited");
    expect(CollectibleSwatch({ rarity: "epic" })).toContain("is-epic");
    expect(CollectibleSwatch({ rarity: "rare" })).toContain("is-rare");
    expect(CollectibleSwatch({ category: "castle" })).toContain("is-castle");
    expect(CollectibleSwatch()).toContain("is-common");
  });

  it("shows only the states the map actually renders in the legend", () => {
    const legend = WorldLegend();

    expect(legend).toContain("Visited");
    expect(legend).toContain("Unvisited");
    expect(legend).toContain("Viewpoint");
    expect(legend).toContain("Peak");
    expect(legend).toContain("Castle");
    expect(legend).toContain("Waterfall");
    expect(legend).toContain("Rare");
    expect(legend).toContain("Epic");
    expect(legend).not.toContain("collectible-type-icon");
    expect(legend).not.toContain("Landmark");
  });

  it("uses the same swatch in quest collectible rows as on the map", () => {
    const row = QuestCollectibleRow({ id: "castle-7", name: "Castle", found: true, rarity: "rare", type: "landmark" });

    expect(row).toContain(CollectibleSwatch({ visited: true, rarity: "rare" }));
    expect(row).not.toContain("collectible-type-icon");
  });
});
