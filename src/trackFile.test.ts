import { describe, expect, it } from "vitest";
import { UserInputError } from "./errors.js";
import { detectTrackFormat, parseGpx, parseImportSport } from "./trackFile.js";

const point = (lat: number, lon: number, time: string, ele?: number) =>
  `<trkpt lat="${lat}" lon="${lon}">${ele === undefined ? "" : `<ele>${ele}</ele>`}<time>${time}</time></trkpt>`;

const gpx = (body: string, header = "") => `<?xml version="1.0"?><gpx version="1.1">${header}<trk>${body}</trk></gpx>`;

describe("parseImportSport", () => {
  it("accepts the three selectable sports", () => {
    for (const sport of ["cycling", "running", "hiking"]) expect(parseImportSport(sport)).toBe(sport);
  });

  it("rejects missing, unknown and non-string values", () => {
    for (const value of [undefined, "", "unknown", "swimming", 3]) {
      expect(() => parseImportSport(value)).toThrow(UserInputError);
    }
  });
});

describe("parseGpx", () => {
  it("reads timestamped points, title and a sport hint", () => {
    const parsed = parseGpx(gpx(
      `<name>Morning &amp; ride</name><type>biking</type><trkseg>${
        point(50.1, 9.1, "2026-01-01T10:00:10Z")}${point(50, 9, "2026-01-01T10:00:00Z")}</trkseg>`
    ));
    expect(parsed.track.map((p) => p.timestampMs)).toEqual([
      Date.parse("2026-01-01T10:00:00Z"), Date.parse("2026-01-01T10:00:10Z")
    ]);
    expect(parsed.metadata.title).toBe("Morning & ride");
    expect(parsed.metadata.activityType).toBe("cycling");
  });

  it("derives elevation gain only when most points carry elevation", () => {
    const elevated = parseGpx(gpx(`<trkseg>${
      point(50, 9, "2026-01-01T10:00:00Z", 100)}${point(50, 9.1, "2026-01-01T10:01:00Z", 110)}${
      point(50, 9.2, "2026-01-01T10:02:00Z", 125)}</trkseg>`));
    expect(elevated.metadata.elevationGainM).toBe(25);
    const flat = parseGpx(gpx(`<trkseg>${
      point(50, 9, "2026-01-01T10:00:00Z")}${point(50, 9.1, "2026-01-01T10:01:00Z")}</trkseg>`));
    expect(flat.metadata.elevationGainM).toBeUndefined();
  });

  it("rejects non-GPX input and tracks without two timestamped points", () => {
    expect(() => parseGpx("<html></html>")).toThrow(UserInputError);
    expect(() => parseGpx(gpx(`<trkseg>${point(50, 9, "2026-01-01T10:00:00Z")}</trkseg>`))).toThrow(UserInputError);
    expect(() => parseGpx(gpx('<trkseg><trkpt lat="50" lon="9"></trkpt><trkpt lat="50" lon="9"></trkpt></trkseg>')))
      .toThrow(UserInputError);
  });
});

describe("detectTrackFormat", () => {
  it("recognises the FIT header signature and treats everything else as GPX", () => {
    const fit = Buffer.alloc(14);
    fit.write(".FIT", 8, "latin1");
    expect(detectTrackFormat(fit)).toBe("fit");
    expect(detectTrackFormat(Buffer.from("<?xml version=\"1.0\"?><gpx></gpx>"))).toBe("gpx");
  });
});
