import { distanceMeters } from "../geometry.js";
import { FARTLEK_CANDIDATE_GENERATION_VERSION, type FartlekCandidate, type OSMWayRecord } from "./fartlekModel.js";

/** Shared OSM nodes have identical coordinates; round to ~1cm to treat them as the same point. */
const coordinateKey = (coordinate: [number, number]): string =>
  `${coordinate[0].toFixed(6)},${coordinate[1].toFixed(6)}`;

const BOUNDARY_MATCH_TOLERANCE_METERS = 20;
const CONTROL_MATCH_TOLERANCE_METERS = 15;
const GRID_CELL_METERS = 50;

interface GridIndex<T> {
  cellOf: (coordinate: [number, number]) => string;
  insert: (coordinate: [number, number], value: T) => void;
  near: (coordinate: [number, number], radiusMeters: number) => T[];
}

/** Coarse metric grid used to avoid O(ways × boundary-nodes) scans across a whole country extract. */
const createGridIndex = <T>(cellMeters: number): GridIndex<T> => {
  const cells = new Map<string, { coordinate: [number, number]; value: T }[]>();
  const metersPerDegreeLon = (latitude: number): number => 111_320 * Math.cos(latitude * Math.PI / 180);
  const cellOf = ([longitude, latitude]: [number, number]): string => {
    const x = longitude * metersPerDegreeLon(latitude);
    const y = latitude * 111_320;
    return `${Math.floor(x / cellMeters)}:${Math.floor(y / cellMeters)}`;
  };
  const neighborKeys = (coordinate: [number, number], radiusMeters: number): string[] => {
    const [longitude, latitude] = coordinate;
    const x = longitude * metersPerDegreeLon(latitude);
    const y = latitude * 111_320;
    const span = Math.ceil(radiusMeters / cellMeters) + 1;
    const cx = Math.floor(x / cellMeters);
    const cy = Math.floor(y / cellMeters);
    const keys: string[] = [];
    for (let dx = -span; dx <= span; dx += 1) {
      for (let dy = -span; dy <= span; dy += 1) keys.push(`${cx + dx}:${cy + dy}`);
    }
    return keys;
  };
  return {
    cellOf,
    insert: (coordinate, value) => {
      const key = cellOf(coordinate);
      const bucket = cells.get(key);
      if (bucket) bucket.push({ coordinate, value });
      else cells.set(key, [{ coordinate, value }]);
    },
    near: (coordinate, radiusMeters) => {
      const results: T[] = [];
      for (const key of neighborKeys(coordinate, radiusMeters)) {
        const bucket = cells.get(key);
        if (!bucket) continue;
        for (const entry of bucket) {
          const [longitude, latitude] = entry.coordinate;
          const [queryLongitude, queryLatitude] = coordinate;
          if (distanceMeters(latitude, longitude, queryLatitude, queryLongitude) <= radiusMeters) {
            results.push(entry.value);
          }
        }
      }
      return results;
    }
  };
};

interface ChainVertex {
  coordinate: [number, number];
  wayId: string;
  tags: Record<string, string>;
  /** Cumulative distance from the chain's first vertex, in meters. */
  arcLengthM: number;
}

interface Chain {
  vertices: ChainVertex[];
}

/** Road-identity key used to decide which ways may be merged into one continuous chain. */
const roadIdentity = (way: OSMWayRecord): string => {
  const ref = way.tags.ref?.trim();
  const name = way.tags.name?.trim();
  if (ref) return `ref:${ref}`;
  if (name) return `name:${name}`;
  return `way:${way.osmId}`;
};

interface Endpoint {
  wayId: string;
  end: "start" | "end";
}

/** Builds continuous chains per road identity by following ways that share an exact endpoint,
 * stopping at any branch point (more than one same-identity neighbor) to keep merges unambiguous. */
const buildChains = (ways: OSMWayRecord[]): Chain[] => {
  const byIdentity = new Map<string, OSMWayRecord[]>();
  for (const way of ways) {
    const key = roadIdentity(way);
    const bucket = byIdentity.get(key);
    if (bucket) bucket.push(way);
    else byIdentity.set(key, [way]);
  }

  const chains: Chain[] = [];
  for (const group of byIdentity.values()) {
    const endpointIndex = new Map<string, Endpoint[]>();
    const addEndpoint = (key: string, endpoint: Endpoint): void => {
      const bucket = endpointIndex.get(key);
      if (bucket) bucket.push(endpoint);
      else endpointIndex.set(key, [endpoint]);
    };
    const byId = new Map(group.map((way) => [way.osmId, way]));
    for (const way of group) {
      addEndpoint(coordinateKey(way.coordinates[0]), { wayId: way.osmId, end: "start" });
      addEndpoint(coordinateKey(way.coordinates[way.coordinates.length - 1]), { wayId: way.osmId, end: "end" });
    }

    const visited = new Set<string>();
    const wayVertices = (way: OSMWayRecord, reversed: boolean): ChainVertex[] => {
      const coordinates = reversed ? [...way.coordinates].reverse() : way.coordinates;
      return coordinates.map((coordinate) => ({ coordinate, wayId: way.osmId, tags: way.tags, arcLengthM: 0 }));
    };
    const otherEndKey = (way: OSMWayRecord, usedKey: string): string => {
      const startKey = coordinateKey(way.coordinates[0]);
      const endKey = coordinateKey(way.coordinates[way.coordinates.length - 1]);
      return usedKey === startKey ? endKey : startKey;
    };

    for (const startWay of group) {
      if (visited.has(startWay.osmId)) continue;
      // Only start a chain at a true dead end (or an arbitrary point in a cycle) to avoid double-walking.
      const startKey = coordinateKey(startWay.coordinates[0]);
      const degreeAtStart = (endpointIndex.get(startKey) ?? []).length;
      if (degreeAtStart > 1 && !visited.has(startWay.osmId)) {
        // Mid-chain or branch point: only begin here if no dead end exists for this way at all
        // (i.e. defer to the dead-end walk below unless this way is otherwise unreachable).
        const endKey = coordinateKey(startWay.coordinates[startWay.coordinates.length - 1]);
        const degreeAtEnd = (endpointIndex.get(endKey) ?? []).length;
        if (degreeAtEnd > 1) continue;
      }

      visited.add(startWay.osmId);
      let vertices = wayVertices(startWay, degreeAtStart > 1);
      let frontierKey = otherEndKey(startWay, coordinateKey(vertices[0].coordinate));

      // Walk forward while exactly one unvisited same-identity neighbor continues the chain.
      for (;;) {
        const candidates = (endpointIndex.get(frontierKey) ?? []).filter((endpoint) => !visited.has(endpoint.wayId));
        if (candidates.length !== 1) break;
        const next = byId.get(candidates[0].wayId);
        if (!next) break;
        // A branch point: more than one of this road's ways meets here besides the one we came from.
        const degreeHere = (endpointIndex.get(frontierKey) ?? []).length;
        if (degreeHere > 2) break;
        visited.add(next.osmId);
        const reversed = candidates[0].end === "end";
        const nextVertices = wayVertices(next, reversed);
        vertices = [...vertices, ...nextVertices.slice(1)];
        frontierKey = otherEndKey(next, frontierKey);
      }

      let arcLength = 0;
      for (let index = 0; index < vertices.length; index += 1) {
        if (index > 0) {
          const [lonA, latA] = vertices[index - 1].coordinate;
          const [lonB, latB] = vertices[index].coordinate;
          arcLength += distanceMeters(latA, lonA, latB, lonB);
        }
        vertices[index] = { ...vertices[index], arcLengthM: arcLength };
      }
      chains.push({ vertices });
    }
  }
  return chains;
};

const consistentTagValue = (vertices: ChainVertex[], key: "name" | "ref"): string | undefined => {
  const values = new Set(vertices.map((vertex) => vertex.tags[key]).filter((value): value is string => Boolean(value)));
  return values.size === 1 ? [...values][0] : undefined;
};

/** Heuristic: favors non-urban context when there is explicit rural/open-road evidence and no
 * lit-residential-street evidence. Missing tags never count as positive evidence either way. */
const isMostlyNonUrban = (vertices: ChainVertex[]): boolean => {
  const total = Math.max(vertices.length, 1);
  const residentialOrLit = vertices.filter((vertex) =>
    vertex.tags.highway === "residential" || vertex.tags.lit === "yes").length;
  const ruralSpeedEvidence = vertices.filter((vertex) => {
    const maxspeed = Number.parseInt(vertex.tags.maxspeed ?? "", 10);
    return Number.isFinite(maxspeed) && maxspeed >= 60;
  }).length;
  if (residentialOrLit / total > 0.3) return false;
  return ruralSpeedEvidence / total > 0.2 || residentialOrLit === 0;
};

export interface BuildFartlekCandidatesOptions {
  /** Boundary nodes, e.g. `traffic_sign=city_limit`. Both candidate ends must match one of these
   * to set `hasClearBoundaries`; chains are still split between every consecutive boundary hit. */
  boundaryNodes: OSMWayRecord[];
  /** Traffic-control nodes (signals/stop/give-way/calming), counted toward `trafficControlCount`. */
  controlNodes: OSMWayRecord[];
}

/**
 * Generates `FartlekCandidate`s from way-geometry OSM records: merges continuous same-identity
 * ways into chains, splits each chain between consecutive boundary-node hits (falling back to the
 * whole chain when no boundary evidence exists), and derives junction/traffic-control counts
 * needed by `scoreFartlekCandidate`.
 */
export const buildFartlekCandidates = (
  ways: OSMWayRecord[],
  options: BuildFartlekCandidatesOptions
): FartlekCandidate[] => {
  const chains = buildChains(ways);

  // Global junction index: any way endpoint not belonging to the current chain's own way set.
  const endpointOwners = new Map<string, Set<string>>();
  for (const way of ways) {
    for (const coordinate of [way.coordinates[0], way.coordinates[way.coordinates.length - 1]]) {
      const key = coordinateKey(coordinate);
      const owners = endpointOwners.get(key);
      if (owners) owners.add(way.osmId);
      else endpointOwners.set(key, new Set([way.osmId]));
    }
  }

  const boundaryIndex = createGridIndex<OSMWayRecord>(GRID_CELL_METERS);
  for (const node of options.boundaryNodes) boundaryIndex.insert(node.coordinates[0], node);
  const controlIndex = createGridIndex<true>(GRID_CELL_METERS);
  for (const node of options.controlNodes) controlIndex.insert(node.coordinates[0], true);
  const boundaryNameAt = (coordinate: [number, number]): string | undefined => {
    const names = new Set(
      boundaryIndex.near(coordinate, BOUNDARY_MATCH_TOLERANCE_METERS)
        .map((node) => node.tags.name?.trim())
        .filter((name): name is string => Boolean(name))
    );
    return names.size === 1 ? [...names][0] : undefined;
  };

  const candidates: FartlekCandidate[] = [];
  for (const chain of chains) {
    const chainWayIds = new Set(chain.vertices.map((vertex) => vertex.wayId));
    const boundaryHitIndices = new Set<number>();
    chain.vertices.forEach((vertex, index) => {
      if (boundaryIndex.near(vertex.coordinate, BOUNDARY_MATCH_TOLERANCE_METERS).length > 0) {
        boundaryHitIndices.add(index);
      }
    });

    const splitIndices = [0, ...[...boundaryHitIndices].sort((a, b) => a - b), chain.vertices.length - 1];
    const segments: [number, number][] = [];
    const seen = new Set<number>();
    for (let i = 0; i < splitIndices.length - 1; i += 1) {
      const start = splitIndices[i];
      const end = splitIndices[i + 1];
      if (end <= start) continue;
      const key = start * 1_000_000 + end;
      if (seen.has(key)) continue;
      seen.add(key);
      segments.push([start, end]);
    }
    // No internal boundary hits at all: still offer the whole chain as a (less-trusted) candidate.
    if (segments.length === 0 && chain.vertices.length >= 2) segments.push([0, chain.vertices.length - 1]);

    for (const [startIndex, endIndex] of segments) {
      const slice = chain.vertices.slice(startIndex, endIndex + 1);
      if (slice.length < 2) continue;
      const lengthMeters = slice[slice.length - 1].arcLengthM - slice[0].arcLengthM;
      const sourceWayIds = [...new Set(slice.map((vertex) => vertex.wayId))];
      const tagsBySegment: Record<string, string>[] = [];
      let lastWayId: string | undefined;
      for (const vertex of slice) {
        if (vertex.wayId !== lastWayId) {
          tagsBySegment.push(vertex.tags);
          lastWayId = vertex.wayId;
        }
      }
      let junctionCount = 0;
      for (let index = 1; index < slice.length - 1; index += 1) {
        const owners = endpointOwners.get(coordinateKey(slice[index].coordinate));
        if (owners && [...owners].some((ownerId) => !chainWayIds.has(ownerId))) junctionCount += 1;
      }
      const trafficControlCount = slice.reduce(
        (count, vertex) => count + (controlIndex.near(vertex.coordinate, CONTROL_MATCH_TOLERANCE_METERS).length > 0 ? 1 : 0),
        0
      );
      const hasClearBoundaries = boundaryHitIndices.has(startIndex) && boundaryHitIndices.has(endIndex);
      const startName = boundaryNameAt(slice[0].coordinate);
      const endName = boundaryNameAt(slice[slice.length - 1].coordinate);
      const roadName = consistentTagValue(slice, "name") ?? consistentTagValue(slice, "ref");
      const name = startName && endName
        ? `${startName} -> ${endName}`
        : startName
          ? `${startName} -> ${roadName ?? "?"}`
          : endName
            ? `${roadName ?? "?"} -> ${endName}`
            : roadName;

      candidates.push({
        id: `fartlek-osm:${sourceWayIds[0]}:${sourceWayIds[sourceWayIds.length - 1]}:${startIndex}:${endIndex}`,
        ...(name ? { name } : {}),
        coordinates: slice.map((vertex) => vertex.coordinate),
        lengthMeters,
        sourceWayIds,
        candidateGenerationVersion: FARTLEK_CANDIDATE_GENERATION_VERSION,
        junctionCount,
        trafficControlCount,
        tagsBySegment,
        hasClearBoundaries,
        mostlyNonUrban: isMostlyNonUrban(slice)
      });
    }
  }
  return candidates;
};
