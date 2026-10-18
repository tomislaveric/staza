import type { Collectible } from "../domain.js";
import { distanceMeters } from "../geometry.js";
import type { NormalizedBatch, RejectedFeature } from "./normalize.js";

export interface DuplicateCandidate {
  incomingId: string;
  incomingName: string;
  existingId: string;
  existingName: string;
  distanceMeters: number;
}

export interface ImportPlan {
  fetchedCount: number;
  normalizedCount: number;
  created: Collectible[];
  updated: Collectible[];
  unchanged: Collectible[];
  rejected: RejectedFeature[];
  missingUpstream: Collectible[];
  possibleDuplicates: DuplicateCandidate[];
}

const DEFAULT_DUPLICATE_RADIUS_METERS = 100;

const sameName = (a: string, b: string): boolean =>
  a.trim().toLocaleLowerCase("de-DE") === b.trim().toLocaleLowerCase("de-DE");

/** Fields whose change means the canonical catalog row should be updated. */
const isUnchanged = (incoming: Collectible, existing: Collectible): boolean =>
  incoming.name === existing.name &&
  incoming.type === existing.type &&
  incoming.latitude === existing.latitude &&
  incoming.longitude === existing.longitude &&
  incoming.radiusMeters === existing.radiusMeters &&
  incoming.value === existing.value &&
  (incoming.status ?? "published") === (existing.status ?? "published") &&
  (incoming.elevationMeters ?? null) === (existing.elevationMeters ?? null) &&
  (incoming.source?.sourceUrl ?? null) === (existing.source?.sourceUrl ?? null) &&
  (incoming.source?.sourceAttribution ?? null) === (existing.source?.sourceAttribution ?? null);

export interface PlanInput {
  batch: NormalizedBatch;
  existingSource: Collectible[];
  otherCollectibles?: Collectible[];
  duplicateRadiusMeters?: number;
}

/**
 * Pure import planner. Categorizes normalized records against the current source rows
 * (created/updated/unchanged), reports source rows absent from the new payload
 * (missing upstream — never auto-deleted), and reports proximity/name collisions with
 * non-source collectibles (never auto-merged).
 */
export const planQuaeldichImport = ({
  batch,
  existingSource,
  otherCollectibles = [],
  duplicateRadiusMeters = DEFAULT_DUPLICATE_RADIUS_METERS
}: PlanInput): ImportPlan => {
  const existingById = new Map(existingSource.map((c) => [c.id, c]));
  const incomingIds = new Set(batch.collectibles.map((c) => c.id));

  const created: Collectible[] = [];
  const updated: Collectible[] = [];
  const unchanged: Collectible[] = [];
  const possibleDuplicates: DuplicateCandidate[] = [];

  for (const incoming of batch.collectibles) {
    const existing = existingById.get(incoming.id);
    if (!existing) created.push(incoming);
    else if (isUnchanged(incoming, existing)) unchanged.push(incoming);
    else updated.push(incoming);

    for (const other of otherCollectibles) {
      const gap = distanceMeters(incoming.latitude, incoming.longitude, other.latitude, other.longitude);
      if (gap <= duplicateRadiusMeters || sameName(incoming.name, other.name)) {
        possibleDuplicates.push({
          incomingId: incoming.id,
          incomingName: incoming.name,
          existingId: other.id,
          existingName: other.name,
          distanceMeters: Math.round(gap)
        });
      }
    }
  }

  const missingUpstream = existingSource.filter((c) => !incomingIds.has(c.id));

  return {
    fetchedCount: batch.fetchedCount,
    normalizedCount: batch.collectibles.length,
    created,
    updated,
    unchanged,
    rejected: batch.rejected,
    missingUpstream,
    possibleDuplicates
  };
};

export const formatImportReport = (
  plan: ImportPlan,
  { sourceUrl, dryRun }: { sourceUrl: string; dryRun: boolean }
): string => {
  const lines: string[] = [];
  lines.push(dryRun ? "quäldich import (dry run) complete" : "quäldich import complete");
  lines.push("");
  lines.push(`Source:     ${sourceUrl}`);
  lines.push(`Fetched:    ${plan.fetchedCount}`);
  lines.push(`Normalized: ${plan.normalizedCount}`);
  lines.push(`Created:    ${plan.created.length}`);
  lines.push(`Updated:    ${plan.updated.length}`);
  lines.push(`Unchanged:  ${plan.unchanged.length}`);
  lines.push(`Rejected:   ${plan.rejected.length}`);
  lines.push(`Possible duplicates: ${plan.possibleDuplicates.length}`);
  lines.push(`Missing from current upstream: ${plan.missingUpstream.length}`);

  const sample = <T,>(items: T[], render: (item: T) => string, limit = 5): void => {
    for (const item of items.slice(0, limit)) lines.push(`  - ${render(item)}`);
    if (items.length > limit) lines.push(`  … and ${items.length - limit} more`);
  };

  if (plan.rejected.length > 0) {
    lines.push("");
    lines.push("Sample rejected:");
    sample(plan.rejected, (r) => `${r.textId ?? r.name ?? "?"}: ${r.reason}`);
  }
  if (plan.possibleDuplicates.length > 0) {
    lines.push("");
    lines.push("Sample possible duplicates (not merged):");
    sample(
      plan.possibleDuplicates,
      (d) => `${d.incomingName} ↔ ${d.existingName} (${d.existingId}) — ${d.distanceMeters} m`
    );
  }
  if (plan.missingUpstream.length > 0) {
    lines.push("");
    lines.push("Sample missing upstream (not deleted):");
    sample(plan.missingUpstream, (c) => `${c.name} (${c.id})`);
  }
  return lines.join("\n");
};
