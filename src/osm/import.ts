import type { Collectible } from "../domain.js";
import { distanceMeters } from "../geometry.js";
import {
  OSM_CATEGORY_ORDER,
  collectibleFromCandidate,
  type CandidateDuplicate,
  type OSMCandidate,
  type ScoredCandidate
} from "./model.js";
import type { RejectedOSMRecord } from "./normalize.js";

const sameName = (left: string, right: string): boolean =>
  left.trim().normalize("NFC").toLocaleLowerCase("de-DE") ===
  right.trim().normalize("NFC").toLocaleLowerCase("de-DE");

const stableValue = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "downloadedAt" && key !== "extractedAt")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
};

const unchanged = (incoming: Collectible, existing: Collectible): boolean =>
  incoming.name === existing.name &&
  incoming.type === existing.type &&
  incoming.primaryCategory === existing.primaryCategory &&
  stableValue(incoming.tags ?? []) === stableValue(existing.tags ?? []) &&
  incoming.latitude === existing.latitude &&
  incoming.longitude === existing.longitude &&
  incoming.radiusMeters === existing.radiusMeters &&
  incoming.value === existing.value &&
  (incoming.rarity ?? null) === (existing.rarity ?? null) &&
  (incoming.status ?? "published") === (existing.status ?? "published") &&
  (incoming.elevationMeters ?? null) === (existing.elevationMeters ?? null) &&
  (incoming.wikidataQid ?? null) === (existing.wikidataQid ?? null) &&
  (incoming.wikipediaReference ?? null) === (existing.wikipediaReference ?? null) &&
  stableValue(incoming.enrichmentMetadata ?? null) === stableValue(existing.enrichmentMetadata ?? null) &&
  (incoming.source?.sourceType ?? null) === (existing.source?.sourceType ?? null) &&
  (incoming.source?.sourceExternalId ?? null) === (existing.source?.sourceExternalId ?? null) &&
  (incoming.source?.sourceUrl ?? null) === (existing.source?.sourceUrl ?? null) &&
  (incoming.source?.sourceAttribution ?? null) === (existing.source?.sourceAttribution ?? null);

const categoryRank = (candidate: OSMCandidate): number =>
  OSM_CATEGORY_ORDER.indexOf(candidate.primaryCategory);

const SPATIAL_CELL_METERS = 250;
const collectibleCell = (collectible: Pick<Collectible, "latitude" | "longitude">): string => {
  const latitudeRadians = collectible.latitude * Math.PI / 180;
  const x = collectible.longitude * 111_320 * Math.cos(latitudeRadians);
  const y = collectible.latitude * 111_320;
  return `${Math.floor(x / SPATIAL_CELL_METERS)}:${Math.floor(y / SPATIAL_CELL_METERS)}`;
};

const appendIndex = <T>(index: Map<string, T[]>, key: string, item: T): void => {
  const values = index.get(key);
  if (values) values.push(item);
  else index.set(key, [item]);
};

const groupedCandidates = (
  scored: ScoredCandidate[]
): { winners: ScoredCandidate[]; duplicates: CandidateDuplicate[]; conflictingIds: Set<string> } => {
  const parent = scored.map((_item, index) => index);
  const find = (index: number): number => {
    if (parent[index] !== index) parent[index] = find(parent[index]);
    return parent[index];
  };
  const join = (left: number, right: number): void => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
  };
  const identities = new Map<string, number>();
  scored.forEach(({ candidate }, index) => {
    const keys = [
      ...(candidate.wikidataQid ? [`qid:${candidate.wikidataQid}`] : []),
      ...(candidate.wikipediaReference && candidate.wikipediaSitelinkMatched
        ? [`wiki:${candidate.wikipediaReference.normalize("NFC").toLocaleLowerCase("de-DE")}`]
        : [])
    ];
    for (const key of keys) {
      const previous = identities.get(key);
      if (previous === undefined) identities.set(key, index);
      else join(index, previous);
    }
  });
  const groups = new Map<number, ScoredCandidate[]>();
  scored.forEach((item, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), item]);
  });
  const winners: ScoredCandidate[] = [];
  const duplicates: CandidateDuplicate[] = [];
  const conflictingIds = new Set<string>();
  for (const group of groups.values()) {
    group.sort((left, right) =>
      categoryRank(left.candidate) - categoryRank(right.candidate) ||
      right.score - left.score ||
      left.candidate.id.localeCompare(right.candidate.id));
    const winner = group[0];
    const privateConflict = group.find((item) => item.decision === "REJECT");
    const qids = new Set(group.flatMap(({ candidate }) =>
      candidate.wikidataQid ? [candidate.wikidataQid] : []));
    const conflictingQids = qids.size > 1;
    if (conflictingQids) {
      for (const item of group) conflictingIds.add(item.candidate.id);
    }
    const mergedTagSet = new Set(group.flatMap(({ candidate }) => candidate.tagsForCatalog));
    for (const category of ["viewpoint", "castle", "peak"] as const) {
      if (winner.candidate.primaryCategory !== category &&
        group.some(({ candidate }) => candidate.categories.includes(category))) {
        mergedTagSet.add(category === "castle" ? "historic" : category === "peak" ? "summit" : "viewpoint");
      }
    }
    const mergedTags = [...mergedTagSet].sort();
    const members = group.map(({ candidate }) => candidate.id).sort();
    winners.push({
      ...winner,
      ...(conflictingQids ? {
        decision: "REVIEW",
        reasons: [...winner.reasons, "Conflicting Wikidata Q-IDs for one exact Wikipedia identity."]
      } : {}),
      ...(privateConflict ? { decision: "REJECT", rejectionReason: privateConflict.rejectionReason } : {}),
      candidate: {
        ...winner.candidate,
        categories: OSM_CATEGORY_ORDER.filter((category) =>
          group.some(({ candidate }) => candidate.categories.includes(category))),
        tagsForCatalog: mergedTags,
        enrichmentMetadata: {
          ...winner.candidate.enrichmentMetadata,
          entityGroupMembers: members
        }
      }
    });
    for (const duplicate of group.slice(1)) {
      const identityMatch = winner.candidate.wikidataQid &&
        winner.candidate.wikidataQid === duplicate.candidate.wikidataQid
        ? "wikidata"
        : "wikipedia";
      duplicates.push({
        candidateId: duplicate.candidate.id,
        candidateName: duplicate.candidate.name ?? duplicate.candidate.wikidataLabel ?? "(unnamed)",
        matchedId: winner.candidate.id,
        matchedName: winner.candidate.name ?? winner.candidate.wikidataLabel ?? "(unnamed)",
        distanceMeters: Math.round(distanceMeters(
          duplicate.candidate.latitude,
          duplicate.candidate.longitude,
          winner.candidate.latitude,
          winner.candidate.longitude
        )),
        identityMatch
      });
    }
  }
  return {
    winners: winners.sort((a, b) => a.candidate.id.localeCompare(b.candidate.id)),
    duplicates,
    conflictingIds
  };
};

export interface OSMImportPlan {
  scanned: number;
  categories: Record<string, number>;
  decisions: Record<string, number>;
  directQidCount: number;
  resolvedQidCount: number;
  unmatchedQidCount: number;
  staleQidCount: number;
  created: Collectible[];
  updated: Collectible[];
  unchanged: Collectible[];
  missingUpstream: Collectible[];
  possibleDuplicates: CandidateDuplicate[];
  rejected: RejectedOSMRecord[];
  scored: ScoredCandidate[];
}

export const planOSMImport = (input: {
  scanned: number;
  candidates: OSMCandidate[];
  scored: ScoredCandidate[];
  rejected: RejectedOSMRecord[];
  existing: Collectible[];
  directQidCount: number;
  resolvedQidCount: number;
  unmatchedQidCount: number;
  extractMetadata: Record<string, unknown>;
  coverageComplete?: boolean;
}): OSMImportPlan => {
  const { winners, duplicates, conflictingIds } = groupedCandidates(input.scored);
  const scored = input.scored.map((item) => conflictingIds.has(item.candidate.id)
    ? {
        ...item,
        decision: item.decision === "REJECT" ? "REJECT" as const : "REVIEW" as const,
        reasons: [...item.reasons, "Conflicting Wikidata Q-IDs for one exact Wikipedia identity."]
      }
    : item);
  const rejectedIdentities = input.rejected.flatMap((item) =>
    (item.osmType === "node" || item.osmType === "way" || item.osmType === "relation") &&
    item.osmId && /^[1-9]\d*$/.test(item.osmId)
      ? [`${item.osmType}:${item.osmId}`]
      : []);
  const incomingIdentities = new Set([
    ...input.candidates.map((candidate) => `${candidate.osmType}:${candidate.osmId}`),
    ...rejectedIdentities
  ]);
  const osmExisting = input.existing.filter((item) => item.source?.sourceType === "osm");
  const byId = new Map(osmExisting.map((item) => [item.id, item]));
  const byWikidata = new Map<string, Collectible[]>();
  const byWikipedia = new Map<string, Collectible[]>();
  const byCell = new Map<string, Collectible[]>();
  for (const existing of input.existing) {
    appendIndex(byCell, collectibleCell(existing), existing);
    if (existing.wikidataQid) {
      appendIndex(byWikidata, existing.wikidataQid, existing);
    }
    if (existing.wikipediaReference) {
      appendIndex(byWikipedia, existing.wikipediaReference, existing);
    }
  }
  const created: Collectible[] = [];
  const updated: Collectible[] = [];
  const unchangedRows: Collectible[] = [];
  const possibleDuplicates = [...duplicates];
  const incomingByCell = new Map<string, ScoredCandidate[]>();
  for (const scored of winners) {
    const candidate = scored.candidate;
    const [cellX, cellY] = collectibleCell(candidate).split(":").map(Number);
    const neighbors = new Map<string, ScoredCandidate>();
    for (let x = cellX - 1; x <= cellX + 1; x += 1) {
      for (let y = cellY - 1; y <= cellY + 1; y += 1) {
        for (const previous of incomingByCell.get(`${x}:${y}`) ?? []) {
          neighbors.set(previous.candidate.id, previous);
        }
      }
    }
    for (const previous of neighbors.values()) {
      const other = previous.candidate;
      const gap = distanceMeters(candidate.latitude, candidate.longitude, other.latitude, other.longitude);
      const compatibleCategory = candidate.categories.some((category) => other.categories.includes(category));
      const name = candidate.name ?? candidate.wikidataLabel;
      const otherName = other.name ?? other.wikidataLabel;
      if (gap <= 100 && compatibleCategory && name && otherName && sameName(name, otherName)) {
        possibleDuplicates.push({
          candidateId: candidate.id,
          candidateName: name,
          matchedId: other.id,
          matchedName: otherName,
          distanceMeters: Math.round(gap),
          identityMatch: "name-distance"
        });
      } else if (gap <= 30) {
        possibleDuplicates.push({
          candidateId: candidate.id,
          candidateName: name ?? "(unnamed)",
          matchedId: other.id,
          matchedName: otherName ?? "(unnamed)",
          distanceMeters: Math.round(gap),
          identityMatch: "proximity"
        });
      }
    }
    appendIndex(incomingByCell, collectibleCell(candidate), scored);
  }
  for (const scored of winners) {
    if (scored.decision !== "AUTO_PUBLISH") continue;
    const collectible = collectibleFromCandidate(scored.candidate, input.extractMetadata);
    const previous = byId.get(collectible.id);
    if (previous) {
      if (unchanged(collectible, previous)) unchangedRows.push(collectible);
      else updated.push(collectible);
    }

    let alreadyRepresented = false;
    const identityMatches = new Map<string, Collectible>();
    if (collectible.wikidataQid) {
      for (const existing of byWikidata.get(collectible.wikidataQid) ?? []) {
        if (existing.id !== collectible.id) identityMatches.set(existing.id, existing);
      }
    }
    if (collectible.wikipediaReference) {
      for (const existing of byWikipedia.get(collectible.wikipediaReference) ?? []) {
        if (existing.id !== collectible.id) identityMatches.set(existing.id, existing);
      }
    }
    for (const existing of identityMatches.values()) {
      const sameWikidata = collectible.wikidataQid &&
        collectible.wikidataQid === existing.wikidataQid;
      const sameWikipedia = collectible.wikipediaReference &&
        collectible.wikipediaReference === existing.wikipediaReference;
      if (sameWikidata || sameWikipedia) {
        possibleDuplicates.push({
          candidateId: collectible.id,
          candidateName: collectible.name,
          matchedId: existing.id,
          matchedName: existing.name,
          distanceMeters: Math.round(distanceMeters(
            collectible.latitude,
            collectible.longitude,
            existing.latitude,
            existing.longitude
          )),
          identityMatch: sameWikidata ? "wikidata" : "wikipedia"
        });
        if (existing.source?.sourceType === "osm") alreadyRepresented = true;
        if (alreadyRepresented) break;
      }
    }
    if (alreadyRepresented) continue;

    const [cellX, cellY] = collectibleCell(collectible).split(":").map(Number);
    const nearby = new Map<string, Collectible>();
    for (let x = cellX - 1; x <= cellX + 1; x += 1) {
      for (let y = cellY - 1; y <= cellY + 1; y += 1) {
        for (const existing of byCell.get(`${x}:${y}`) ?? []) nearby.set(existing.id, existing);
      }
    }
    for (const existing of nearby.values()) {
      if (existing.id === collectible.id || identityMatches.has(existing.id)) continue;
      const gap = distanceMeters(
        collectible.latitude,
        collectible.longitude,
        existing.latitude,
        existing.longitude
      );
      const category = existing.primaryCategory;
      if (gap <= 100 && category === collectible.primaryCategory && sameName(collectible.name, existing.name)) {
        possibleDuplicates.push({
          candidateId: collectible.id,
          candidateName: collectible.name,
          matchedId: existing.id,
          matchedName: existing.name,
          distanceMeters: Math.round(gap),
          identityMatch: "name-distance"
        });
      } else if (gap <= 30) {
        possibleDuplicates.push({
          candidateId: collectible.id,
          candidateName: collectible.name,
          matchedId: existing.id,
          matchedName: existing.name,
          distanceMeters: Math.round(gap),
          identityMatch: "proximity"
        });
      }
    }
    if (!previous) created.push(collectible);
  }

  const categories: Record<string, number> = {
    viewpoint: 0,
    peak: 0,
    castle: 0,
    waterfall: 0,
    place: 0
  };
  for (const candidate of input.candidates) {
    for (const category of candidate.categories) categories[category] += 1;
  }
  const decisions: Record<string, number> = {
    AUTO_PUBLISH: 0,
    REVIEW: 0,
    IGNORE: 0,
    REJECT: input.rejected.length
  };
  for (const result of scored) decisions[result.decision] += 1;
  const missingUpstream = input.coverageComplete === false ? [] : osmExisting.filter((item) => {
    const externalId = item.source?.sourceExternalId;
    return externalId !== undefined && !incomingIdentities.has(externalId);
  });
  return {
    scanned: input.scanned,
    categories,
    decisions,
    directQidCount: input.directQidCount,
    resolvedQidCount: input.resolvedQidCount,
    unmatchedQidCount: input.unmatchedQidCount,
    staleQidCount: new Set(input.candidates
      .filter((candidate) => candidate.enrichmentMetadata?.state === "stale-cache")
      .map((candidate) => candidate.wikidataQid)
      .filter((qid): qid is string => qid !== undefined)).size,
    created,
    updated,
    unchanged: unchangedRows,
    missingUpstream,
    possibleDuplicates,
    rejected: input.rejected,
    scored
  };
};

export const formatOSMImportReport = (
  plan: OSMImportPlan,
  options: {
    dryRun: boolean;
    sourceUrl: string;
    extractMetadata: Record<string, unknown>;
    writeBlocked?: boolean;
  }
): string => {
  const lines = [
    options.writeBlocked
      ? "OSM + Wikidata import blocked: incomplete source coverage"
      : options.dryRun
        ? "OSM + Wikidata import (dry run) complete"
        : "OSM + Wikidata import complete",
    "",
    `Source:                  ${options.sourceUrl}`,
    `Coverage complete:       ${String(options.extractMetadata.coverageComplete ?? true)}`,
    `Extract version:         ${String(options.extractMetadata.sourceVersion ?? "provided input")}`,
    `Extract generated:       ${String(options.extractMetadata.generatedAt ?? "provided input")}`,
    `OSM objects scanned:     ${plan.scanned}`,
    `Category candidates:     ${Object.values(plan.categories).reduce((sum, count) => sum + count, 0)}`,
    `  viewpoint / peak / castle / waterfall / place: ${plan.categories.viewpoint} / ${plan.categories.peak} / ${plan.categories.castle} / ${plan.categories.waterfall} / ${plan.categories.place}`,
    `Direct Wikidata Q-IDs:   ${plan.directQidCount}`,
    `Resolved Wikidata:       ${plan.resolvedQidCount}`,
    `Unmatched Wikidata:      ${plan.unmatchedQidCount}`,
    `Stale cache reused:      ${plan.staleQidCount}`,
    `AUTO_PUBLISH:            ${plan.decisions.AUTO_PUBLISH}`,
    `REVIEW:                  ${plan.decisions.REVIEW}`,
    `IGNORE:                  ${plan.decisions.IGNORE}`,
    `REJECT:                  ${plan.decisions.REJECT}`,
    `Created:                 ${plan.created.length}`,
    `Updated:                 ${plan.updated.length}`,
    `Unchanged:               ${plan.unchanged.length}`,
    `Possible duplicates:     ${plan.possibleDuplicates.length}`,
    `Missing from upstream:   ${plan.missingUpstream.length}`,
  ];
  const sample = <T,>(items: T[], render: (item: T) => string, limit = 5): void => {
    for (const item of items.slice(0, limit)) lines.push(`  - ${render(item)}`);
    if (items.length > limit) lines.push(`  … and ${items.length - limit} more`);
  };
  const auto = [...plan.scored].filter((item) => item.decision === "AUTO_PUBLISH")
    .sort((left, right) => right.score - left.score || left.candidate.id.localeCompare(right.candidate.id));
  if (auto.length > 0) {
    lines.push("", "Top AUTO_PUBLISH candidates:");
    sample(auto, (item) => `${item.score} ${item.candidate.primaryCategory}: ${item.candidate.name ?? item.candidate.wikidataLabel} (${item.candidate.id})`);
  }
  const review = [...plan.scored].filter((item) => item.decision === "REVIEW")
    .sort((left, right) => right.score - left.score || left.candidate.id.localeCompare(right.candidate.id));
  if (review.length > 0) {
    lines.push("", "Sample review candidates:");
    sample(review, (item) => `${item.score}: ${item.candidate.name ?? item.candidate.wikidataLabel ?? "(unnamed)"} (${item.candidate.id})`);
  }
  const unresolved = plan.scored.filter((item) => {
    const metadata = item.candidate.enrichmentMetadata;
    return metadata?.state === "unresolved" || metadata?.state === "stale-cache";
  });
  if (unresolved.length > 0) {
    lines.push("", "Sample unresolved/failed Wikidata enrichment:");
    sample(unresolved, (item) =>
      `${item.candidate.wikidataQid ?? "?"}: ${String(
        item.candidate.enrichmentMetadata?.error ??
        item.candidate.enrichmentMetadata?.refreshError ??
        "unresolved"
      )}`);
  }
  if (plan.rejected.length > 0) {
    lines.push("", "Sample rejection reasons:");
    sample(plan.rejected, (item) => `${item.osmType ?? "?"}:${item.osmId ?? "?"} ${item.reason}`);
  }
  if (plan.possibleDuplicates.length > 0) {
    lines.push("", "Sample possible duplicates (report-only; never auto-merged):");
    sample(plan.possibleDuplicates, (item) => `${item.candidateName} ↔ ${item.matchedName} (${item.identityMatch}, ${item.distanceMeters} m)`);
  }
  if (plan.missingUpstream.length > 0) {
    lines.push("", "Sample missing upstream (not deleted or archived):");
    sample(plan.missingUpstream, (item) => `${item.name} (${item.id})`);
  }
  if (options.extractMetadata.coverageComplete === false) {
    lines.push("", "Source coverage is incomplete; missing-upstream conclusions are suppressed.");
  }
  return lines.join("\n");
};
