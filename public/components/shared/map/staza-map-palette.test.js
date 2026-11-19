import { describe, expect, it } from "vitest";
import { STAZA_MAP_PALETTE } from "./staza-map-palette.js";
import { STAZA_MAP_PALETTE as SERVED_PALETTE } from "../../../../src/mapPalette.ts";

describe("STAZA_MAP_PALETTE", () => {
  it("matches the palette served to native clients", () => {
    expect(STAZA_MAP_PALETTE).toEqual(SERVED_PALETTE);
  });
});
