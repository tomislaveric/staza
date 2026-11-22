import { escapeHtml } from "../collected-list.js";
import { collectibleCategory } from "./collectible-features.js";
import { formatDistance } from "./fartlek-detail.js";

/** Primary riding characters of a Flowline, as named in the reveal summary and on cards. */
export const characterOrder = ["flow", "endurance", "explore"];

export const characterLabels = { flow: "High-flow", endurance: "Endurance", explore: "Exploration" };

export const characterScoreLabels = { flow: "Flow", endurance: "Endurance", explore: "Explore" };

export const characterScore = (flowline, tag) =>
  tag === "flow" ? flowline.flowScore : tag === "endurance" ? flowline.enduranceScore : flowline.exploreScore;

export const flowlineCharacter = (flowline) => flowline.character ?? { primary: "flow", tags: [] };

/**
 * The map CTA. Explore shows the area's opportunities for this session only: nothing is saved
 * until the player saves an Exploration, so exploring the same area again shows them again.
 */
export const exploreCta = (exploreAllowed) => exploreAllowed
  ? { action: "explore", label: "Explore this area" }
  : { action: "zoom", label: "Zoom in to explore", disabled: true };

const plural = (count, singular, pluralForm) => `${count} ${count === 1 ? singular : pluralForm}`;

export const opportunityText = (count) => plural(count, "opportunity", "opportunities");

/** "3 high-flow · 2 endurance · 2 exploration": only characters that occur. */
export const characterBreakdown = (byCharacter = {}) => characterOrder
  .filter((tag) => byCharacter[tag] > 0)
  .map((tag) => ({ tag, count: byCharacter[tag], label: characterLabels[tag].toLowerCase() }));

const closeButton = '<button type="button" class="world-detail-close" data-explore-close aria-label="Close">\u00d7</button>';

/**
 * The card shown after Explore. `state.phase` is "exploring" while the request runs; otherwise
 * `state.result` is the server's explore response. Generating a route is the primary next step.
 */
export const ExploreResultCard = (state) => {
  if (state.phase === "exploring") {
    return '<section class="world-explore-card is-exploring" aria-live="polite"><p role="status">Exploring this area\u2026</p></section>';
  }
  if (state.phase === "error") {
    return `<section class="world-explore-card" aria-live="polite">
      <header><h2>Couldn't explore this area</h2>${closeButton}</header>
      <p role="alert">${escapeHtml(state.error)}</p>
    </section>`;
  }
  const { result } = state;
  if (result.outcome === "nothing_new") {
    return `<section class="world-explore-card" aria-live="polite" data-explore-outcome="nothing_new">
      <header><h2>Nothing new to explore here</h2>${closeButton}</header>
      <p>Try exploring a wider area or another region.</p>
      <div class="world-explore-card-actions">
        <button type="button" data-explore-zoom-out>Zoom out</button>
        <button type="button" data-explore-close>Explore another area</button>
      </div>
    </section>`;
  }
  const flowlines = result.summary?.total ?? result.flowlines?.length ?? 0;
  const collectibles = result.summary?.collectibles ?? result.collectibles?.length ?? 0;
  const breakdown = characterBreakdown(result.summary?.byCharacter);
  return `<section class="world-explore-card is-reveal" aria-live="polite" data-explore-outcome="${escapeHtml(result.outcome)}">
    <header>
      <div>
        <p class="world-detail-meta"><small>Opportunities in this area</small></p>
        <h2>${escapeHtml(opportunityText(flowlines + collectibles))}</h2>
      </div>
      ${closeButton}
    </header>
    <ul class="world-explore-breakdown" aria-label="Opportunities">
      ${breakdown.map(({ tag, count, label }) => `<li class="is-${tag}"><strong>${count}</strong> <span>${escapeHtml(label)}</span></li>`).join("")}
      ${collectibles ? `<li class="is-collectibles"><strong>${collectibles}</strong> <span>${collectibles === 1 ? "collectible" : "collectibles"}</span></li>` : ""}
    </ul>
    <p class="route-planner-note">Shown for this session only. Save an Exploration to keep a route.</p>
    <div class="world-explore-card-actions">
      <button type="button" class="is-primary" data-explore-generate>Generate route</button>
      <button type="button" data-explore-discoveries>View opportunities</button>
      <button type="button" data-explore-close>Close</button>
    </div>
  </section>`;
};

/** Collectible counts for the opportunities panel, by category. */
export const areaCounts = (collectibles, flowlines) => {
  const counts = { flowlines: flowlines.length, place: 0, peak: 0, viewpoint: 0, castle: 0, mountain_pass: 0 };
  for (const item of collectibles) {
    const category = collectibleCategory(item);
    if (category in counts) counts[category] += 1;
  }
  return counts;
};

const countLabels = [
  ["flowlines", "Flowlines"], ["place", "Places"], ["peak", "Peaks"], ["viewpoint", "Viewpoints"],
  ["castle", "Castles"], ["mountain_pass", "Mountain passes"]
];

export const discoverySorts = [
  ["flow", "Best Flow"], ["endurance", "Best Endurance"], ["unridden", "Unridden"], ["nearby", "Nearby"]
];

const midpoint = (flowline) => {
  const coordinates = flowline.geometry?.coordinates ?? [];
  const [lon, lat] = coordinates[Math.floor(coordinates.length / 2)] ?? [0, 0];
  return { latitude: lat, longitude: lon };
};

const squaredDistance = (a, b) => {
  const dLat = a.latitude - b.latitude;
  const dLon = (a.longitude - b.longitude) * Math.cos(a.latitude * Math.PI / 180);
  return dLat * dLat + dLon * dLon;
};

/** Flowlines ordered for one discoveries tab. Ties keep name order so the list is stable. */
export const sortDiscoveries = (flowlines, sort, origin) => {
  const byName = (left, right) => left.name.localeCompare(right.name);
  const score = (tag) => (flowline) => characterScore(flowline, tag) ?? -1;
  const list = [...flowlines];
  if (sort === "endurance") return list.sort((a, b) => score("endurance")(b) - score("endurance")(a) || byName(a, b));
  if (sort === "unridden") {
    return list.sort((a, b) => Number(a.completed) - Number(b.completed) || score("flow")(b) - score("flow")(a) || byName(a, b));
  }
  if (sort === "nearby" && origin) {
    return list.sort((a, b) => squaredDistance(origin, midpoint(a)) - squaredDistance(origin, midpoint(b)) || byName(a, b));
  }
  return list.sort((a, b) => score("flow")(b) - score("flow")(a) || byName(a, b));
};

/** Character badge plus at most two scores: the primary one and road quality. */
export const FlowlineFacts = (flowline) => {
  const { primary } = flowlineCharacter(flowline);
  const primaryScore = characterScore(flowline, primary);
  return `
    <span class="flowline-character is-${primary}">${escapeHtml(characterLabels[primary])}</span>
    <dl class="flowline-facts">
      <div><dt>Length</dt><dd>${escapeHtml(formatDistance(flowline.lengthMeters))}</dd></div>
      ${primaryScore === undefined ? "" : `<div><dt>${escapeHtml(characterScoreLabels[primary])}</dt><dd>${Math.round(primaryScore)}</dd></div>`}
      ${flowline.roadQualityScore === undefined ? "" : `<div><dt>Road quality</dt><dd>${Math.round(flowline.roadQualityScore)}</dd></div>`}
    </dl>
  `;
};

const addButton = (flowline, routeStopIds) => {
  const added = routeStopIds.includes(flowline.id);
  return `<button type="button" data-flowline-add-route="${escapeHtml(flowline.id)}" aria-pressed="${added}">${added ? "Added to route" : "Add to route"}</button>`;
};

/** "View opportunities": what this Explore session found, with its Flowlines sorted by one tab. */
export const DiscoveriesPanel = ({ flowlines, collectibles, sort = "flow", origin, routeStopIds = [] }) => {
  const counts = areaCounts(collectibles, flowlines);
  const sorted = sortDiscoveries(flowlines, sort, origin);
  return `
    <section class="world-detail discoveries-panel" aria-label="Opportunities in this area">
      <header>
        <h2>Opportunities in this area</h2>
        <button type="button" class="world-detail-close" data-discoveries-close aria-label="Close opportunities">\u00d7</button>
      </header>
      <dl class="discoveries-counts">
        ${countLabels.filter(([key]) => key === "flowlines" || counts[key] > 0)
          .map(([key, label]) => `<div><dt>${label}</dt><dd>${counts[key]}</dd></div>`).join("")}
      </dl>
      <div class="discoveries-sorts" role="group" aria-label="Sort Flowlines">
        ${discoverySorts.filter(([value]) => value !== "nearby" || origin)
          .map(([value, label]) => `<button type="button" data-discoveries-sort="${value}" aria-pressed="${sort === value}">${label}</button>`).join("")}
      </div>
      ${sorted.length ? `<ol class="discoveries-list" aria-label="Flowline opportunities">
        ${sorted.map((flowline) => `
          <li class="discovery-card" data-discovery="${escapeHtml(flowline.id)}">
            <p class="discovery-card-title"><b class="fartlek-swatch" aria-hidden="true"></b><strong data-user-content>${escapeHtml(flowline.name)}</strong>
              <small>${flowline.completed ? "Completed" : "Unridden"}</small></p>
            ${FlowlineFacts(flowline)}
            <div class="discovery-card-actions">
              <button type="button" data-discovery-view="${escapeHtml(flowline.id)}">View on map</button>
              ${addButton(flowline, routeStopIds)}
            </div>
          </li>`).join("")}
      </ol>` : '<p class="route-planner-note">No Flowline opportunities here. Explore another area to find some.</p>'}
      <div class="world-explore-card-actions">
        <button type="button" class="is-primary" data-discoveries-generate>Generate route</button>
        <button type="button" data-discoveries-plan>Plan a route</button>
      </div>
    </section>
  `;
};

/** Staggered, subtle appearance of an Explore session's Flowlines; immediate with reduced motion. */
export const revealSequence = (flowlines, { reducedMotion = false, stepMs = 140 } = {}) =>
  flowlines.map((flowline, index) => ({ flowline, delayMs: reducedMotion ? 0 : index * stepMs }));

export { addButton as FlowlineAddButton };
