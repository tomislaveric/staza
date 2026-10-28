import type { LatLon } from "../routePlanning/types.js";

export interface GpxRoute {
  name: string;
  description?: string;
  start: LatLon;
  /** [lon, lat] pairs, as stored on planned routes. */
  coordinates: [number, number][];
  /** ISO timestamp; omitted when unknown. */
  createdAt?: string;
}

// Characters that are not allowed in XML 1.0 documents are dropped; the rest is escaped.
const INVALID_XML_CHARS = /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;

export const escapeXml = (value: string): string => value
  .replace(INVALID_XML_CHARS, "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

/** A filename-safe slug for the Content-Disposition of a GPX download. */
export const gpxFilename = (name: string): string =>
  `${name.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60).toLowerCase() || "route"}.gpx`;

const number = (value: number, digits: number): string => String(Number(value.toFixed(digits)));

/** GPX 1.1 document with one track holding the planned route. */
export const buildGpx = (route: GpxRoute): string => {
  const points = route.coordinates
    .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat))
    .map(([lon, lat]) => `      <trkpt lat="${number(lat, 6)}" lon="${number(lon, 6)}"/>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Staza" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escapeXml(route.name)}</name>${route.description ? `\n    <desc>${escapeXml(route.description)}</desc>` : ""}${route.createdAt ? `\n    <time>${escapeXml(route.createdAt)}</time>` : ""}
  </metadata>
  <wpt lat="${number(route.start.lat, 6)}" lon="${number(route.start.lon, 6)}">
    <name>Start</name>
  </wpt>
  <trk>
    <name>${escapeXml(route.name)}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>
`;
};
