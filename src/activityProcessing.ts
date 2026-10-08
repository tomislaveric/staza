import { deriveActivityResult } from "./activity.js";
import type { Activity, ActivityResult } from "./domain.js";
import type { CollectibleRepository } from "./persistence/collectibleRepository.js";
import type { FartlekRepository } from "./persistence/fartlekRepository.js";
import { getRelevantCollectibles, getRelevantFartleks } from "./worldQuery.js";

export interface CanonicalActivityResult {
  result: ActivityResult;
  totalCollectibles: number;
  relevantCollectibles: number;
}

/**
 * The single, source-independent gameplay derivation used by every import source (FIT upload,
 * legacy FIT jobs, Strava). Collectibles, Fartlek completions, and XP come only from here.
 */
export const createCanonicalActivityProcessor = (
  collectibles: Pick<CollectibleRepository, "listAll">,
  fartleks: Pick<FartlekRepository, "listPublished">,
  paddingMeters: number
) => async (activity: Activity): Promise<CanonicalActivityResult> => {
  const [allCollectibles, allFartleks] = await Promise.all([collectibles.listAll(), fartleks.listPublished()]);
  const relevantCollectibles = getRelevantCollectibles(allCollectibles, activity.route, paddingMeters);
  const relevantFartleks = getRelevantFartleks(allFartleks, activity.route, paddingMeters);
  return {
    result: deriveActivityResult(activity, relevantCollectibles, relevantFartleks),
    totalCollectibles: allCollectibles.length,
    relevantCollectibles: relevantCollectibles.length
  };
};

export type CanonicalActivityProcessor = ReturnType<typeof createCanonicalActivityProcessor>;
