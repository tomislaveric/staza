import { describe, expect, it } from "vitest";
import { CollectibleDetail, CollectibleSource } from "./collectible-detail.js";

const pass = (overrides = {}) => ({
  id: "quaeldich:col-agnel",
  name: "Col Agnel",
  type: "mountain_pass",
  value: 600,
  found: false,
  elevationMeters: 2744,
  source: {
    sourceType: "quaeldich",
    sourceExternalId: "col-agnel",
    sourceUrl: "https://www.quaeldich.de/paesse/col-agnel/",
    sourceAttribution: "quäldich.de"
  },
  ...overrides
});

describe("CollectibleSource", () => {
  it("renders a clickable, safe source link when a deeplink is present", () => {
    const html = CollectibleSource(pass().source);
    expect(html).toContain("Source:");
    expect(html).toContain("quäldich.de");
    expect(html).toContain('href="https://www.quaeldich.de/paesse/col-agnel/"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("renders plain attribution without a link when no url is present", () => {
    const html = CollectibleSource({ sourceType: "quaeldich", sourceExternalId: "x", sourceAttribution: "quäldich.de" });
    expect(html).toContain("quäldich.de");
    expect(html).not.toContain("<a ");
  });

  it("renders nothing for curated collectibles without a source", () => {
    expect(CollectibleSource(undefined)).toBe("");
    expect(CollectibleSource({ sourceType: "x", sourceExternalId: "y" })).toBe("");
  });
});

describe("CollectibleDetail", () => {
  it("shows elevation and source attribution for imported passes", () => {
    const html = CollectibleDetail(pass());
    expect(html).toContain("2744");
    expect(html).toContain("m");
    expect(html).toContain("Source:");
    expect(html).toContain("quäldich.de");
  });

  it("omits elevation and source for a curated collectible", () => {
    const html = CollectibleDetail({ id: "c1", name: "Riverside Coin", type: "coin", value: 15, found: true });
    expect(html).not.toContain("Source:");
    expect(html).not.toContain("collectible-detail-elevation");
  });

  it("shows an imported OSM category and source link", () => {
    const html = CollectibleDetail(pass({
      type: "landmark",
      primaryCategory: "castle",
      source: {
        sourceType: "osm",
        sourceExternalId: "way:42",
        sourceUrl: "https://www.openstreetmap.org/way/42",
        sourceAttribution: "© OpenStreetMap contributors"
      }
    }));
    expect(html).toContain("<small>Castle</small>");
    expect(html).toContain("© OpenStreetMap contributors");
    expect(html).toContain('href="https://www.openstreetmap.org/way/42"');
  });
});

describe("CollectibleDetail route action", () => {
  it("offers an in-app Route to button instead of an external link", () => {
    const html = CollectibleDetail(pass({ latitude: 44.6, longitude: 6.9 }));
    expect(html).toContain('data-collectible-route="quaeldich:col-agnel"');
    expect(html).not.toContain("openstreetmap.org");
  });
});
