import { distanceMeters } from "../geometry.js";
import type { LatLon } from "./types.js";

const EARTH_RADIUS_M = 6_371_000;
const RADIANS = Math.PI / 180;

export type LonLat = [number, number];

export const distanceBetween = (a: LatLon, b: LatLon): number => distanceMeters(a.lat, a.lon, b.lat, b.lon);

export const toLatLon = ([lon, lat]: LonLat): LatLon => ({ lat, lon });

/** Compass-style bearing in radians in [0, 2π) from a to b on a local flat approximation. */
export const bearing = (from: LatLon, to: LatLon): number => {
  const x = (to.lon - from.lon) * Math.cos(from.lat * RADIANS);
  const y = to.lat - from.lat;
  const angle = Math.atan2(x, y);
  return angle < 0 ? angle + 2 * Math.PI : angle;
};

/** Equirectangular projection around an origin; accurate enough at ride scale. */
export class LocalProjection {
  private readonly cosLat: number;

  constructor(private readonly origin: LatLon) {
    this.cosLat = Math.cos(origin.lat * RADIANS);
  }

  project([lon, lat]: LonLat): [number, number] {
    return [
      (lon - this.origin.lon) * RADIANS * EARTH_RADIUS_M * this.cosLat,
      (lat - this.origin.lat) * RADIANS * EARTH_RADIUS_M
    ];
  }
}

export const lineLengthMeters = (coordinates: LonLat[]): number => {
  let total = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    total += distanceBetween(toLatLon(coordinates[index - 1]), toLatLon(coordinates[index]));
  }
  return total;
};

/** Point at a given distance along a polyline, clamped to its ends. */
export const pointAlong = (coordinates: LonLat[], distance: number): LonLat => {
  if (coordinates.length === 0) throw new Error("Cannot interpolate along an empty line.");
  if (distance <= 0) return coordinates[0];
  let travelled = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const step = distanceBetween(toLatLon(coordinates[index - 1]), toLatLon(coordinates[index]));
    if (travelled + step >= distance && step > 0) {
      const fraction = (distance - travelled) / step;
      const [lonA, latA] = coordinates[index - 1];
      const [lonB, latB] = coordinates[index];
      return [lonA + (lonB - lonA) * fraction, latA + (latB - latA) * fraction];
    }
    travelled += step;
  }
  return coordinates[coordinates.length - 1];
};

/** Evenly spaced samples along a polyline, always including both ends. */
export const sampleAlong = (coordinates: LonLat[], spacingMeters: number): LonLat[] => {
  if (coordinates.length < 2) return [...coordinates];
  const length = lineLengthMeters(coordinates);
  const count = Math.max(1, Math.ceil(length / spacingMeters));
  return Array.from({ length: count + 1 }, (_value, index) => pointAlong(coordinates, (length * index) / count));
};

interface IndexedSegment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  startAlong: number;
  length: number;
}

export interface NearestResult {
  distance: number;
  /** Distance along the indexed line of the closest point. */
  along: number;
}

/**
 * Grid-bucketed polyline for repeated nearest-point queries with a bounded search radius.
 * Route geometries have thousands of vertices; this keeps validation linear-ish.
 */
export class PolylineIndex {
  readonly projection: LocalProjection;
  readonly lengthMeters: number;
  private readonly cells = new Map<string, IndexedSegment[]>();

  constructor(coordinates: LonLat[], private readonly cellSize = 100) {
    const origin = coordinates[0] ? toLatLon(coordinates[0]) : { lat: 0, lon: 0 };
    this.projection = new LocalProjection(origin);
    let along = 0;
    const projected = coordinates.map((coordinate) => this.projection.project(coordinate));
    for (let index = 1; index < projected.length; index += 1) {
      const [ax, ay] = projected[index - 1];
      const [bx, by] = projected[index];
      const length = Math.hypot(bx - ax, by - ay);
      const segment = { ax, ay, bx, by, startAlong: along, length };
      along += length;
      const minX = Math.floor(Math.min(ax, bx) / cellSize);
      const maxX = Math.floor(Math.max(ax, bx) / cellSize);
      const minY = Math.floor(Math.min(ay, by) / cellSize);
      const maxY = Math.floor(Math.max(ay, by) / cellSize);
      for (let x = minX; x <= maxX; x += 1) {
        for (let y = minY; y <= maxY; y += 1) {
          const key = `${x}:${y}`;
          const bucket = this.cells.get(key);
          if (bucket) bucket.push(segment);
          else this.cells.set(key, [segment]);
        }
      }
    }
    this.lengthMeters = along;
  }

  /** Nearest point on the line within maxRadius, or undefined. */
  nearest(coordinate: LonLat, maxRadius: number, accept: (along: number) => boolean = () => true): NearestResult | undefined {
    const [px, py] = this.projection.project(coordinate);
    const reach = Math.ceil(maxRadius / this.cellSize);
    const cellX = Math.floor(px / this.cellSize);
    const cellY = Math.floor(py / this.cellSize);
    let best: NearestResult | undefined;
    const seen = new Set<IndexedSegment>();
    for (let x = cellX - reach; x <= cellX + reach; x += 1) {
      for (let y = cellY - reach; y <= cellY + reach; y += 1) {
        for (const segment of this.cells.get(`${x}:${y}`) ?? []) {
          if (seen.has(segment)) continue;
          seen.add(segment);
          const dx = segment.bx - segment.ax;
          const dy = segment.by - segment.ay;
          const lengthSquared = dx * dx + dy * dy;
          const t = lengthSquared === 0
            ? 0
            : Math.max(0, Math.min(1, ((px - segment.ax) * dx + (py - segment.ay) * dy) / lengthSquared));
          const distance = Math.hypot(segment.ax + dx * t - px, segment.ay + dy * t - py);
          const along = segment.startAlong + segment.length * t;
          if (distance <= maxRadius && (!best || distance < best.distance) && accept(along)) {
            best = { distance, along };
          }
        }
      }
    }
    return best;
  }
}
