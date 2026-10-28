import { escapeHtml } from "../collected-list.js";
import { CollectibleSwatch } from "./collectible-swatch.js";

export const DISTANCE_PRESETS_KM = [30, 50, 80];
export const DURATION_PRESETS_MIN = [60, 120, 180];

export const SPORT_OPTIONS = [
  { value: "cycling", label: "Cycling", noun: "ride" },
  { value: "running", label: "Running", noun: "run" },
  { value: "hiking", label: "Hiking", noun: "hike" }
];

/** Sport-specific word for the outing: "ride", "run" or "hike". */
export const outingNoun = (sport) => SPORT_OPTIONS.find((option) => option.value === sport)?.noun ?? "outing";

const proposalLabels = {
  quick: "Quick",
  balanced: "Balanced",
  adventure: "Adventure"
};

const proposalHints = {
  discovery: "Discovery",
  climb: "Climb"
};

/**
 * Client state of one route-first "Explore this Area" session. `phase` is explicit:
 * - "configure": choose start, route type and ride length; no targets are shown.
 * - "generating": the planner chooses target combinations and routes them.
 * - "proposals": route proposals exist but none is selected.
 * - "customize": one proposal is selected; its targets are visible and editable.
 *   `status` "rerouting" while an edit is re-planned.
 * - "confirming": the selected route is being persisted.
 * Proposals are ephemeral: `customizedById` maps an original proposal id to its edited route.
 */
export const createExplorationState = (area) => ({
  area,
  phase: "configure",
  status: "idle",
  routeType: "round_trip",
  sport: "cycling",
  start: undefined,
  end: undefined,
  constraintType: "distance",
  distanceKm: 50,
  durationMin: 120,
  picking: "start",
  explorationId: undefined,
  proposals: [],
  customizedById: {},
  selectedProposalId: undefined,
  previewProposalId: undefined,
  hoveredTargetId: undefined,
  catalog: { collectibles: [], flowlines: [] },
  limits: { maxRouteTargets: 12 },
  truncated: false,
  warnings: [],
  adding: false,
  pendingTargetIds: undefined,
  error: undefined
});

export const formatRouteDistance = (meters) => `${(meters / 1000).toFixed(meters >= 100_000 ? 0 : 1)} km`;

export const formatRouteDuration = (seconds) => {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}:${String(totalMinutes % 60).padStart(2, "0")} h`;
};

const plural = (count, singular, pluralForm) => `${count} ${count === 1 ? singular : pluralForm}`;

/** Destination counts: "1 Peak · 2 Places". Flowlines are not destinations. */
export const targetSummaryText = (summary) => [
  summary.peaks ? plural(summary.peaks, "Peak", "Peaks") : "",
  summary.places ? plural(summary.places, "Place", "Places") : "",
  summary.other ? plural(summary.other, "other target", "other targets") : ""
].filter(Boolean).join(" · ");

const formatPoint = (point) => `${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`;

/** The current version of a proposal: its customization if the player edited it, else the original. */
export const activeProposal = (state, proposalId = state.selectedProposalId) => {
  if (!proposalId) return undefined;
  return state.customizedById[proposalId] ?? state.proposals.find((proposal) => proposal.id === proposalId);
};

/** Ordered contents of a route: planned targets plus targets it passes nearby. */
export const routeTargetIds = (proposal) => proposal
  ? [...new Set([...proposal.includedTargetIds, ...(proposal.nearbyTargetIds ?? [])])]
  : [];

/** Flowlines a route naturally rides: derived, informational metadata. */
export const traversedFlowlines = (proposal) => proposal?.traversedFlowlines ?? [];

export const flowlinesText = (flowlines) => plural(flowlines.length, "Flowline", "Flowlines");

/** Name and kind of a catalog destination (collectible) of the frozen area. */
export const findCatalogTarget = (catalog, id) => {
  const collectible = catalog?.collectibles.find((item) => item.id === id);
  return collectible
    ? {
      category: collectible.primaryCategory ?? collectible.type ?? "coin",
      id,
      name: collectible.name,
      visited: Boolean(collectible.found)
    }
    : undefined;
};

/** Validates the ride and builds the generate request; the request never contains targets. */
export const buildGenerateRequest = (state) => {
  if (!state.start) return { error: "Choose a start on the map." };
  if (state.routeType === "point_to_point" && !state.end) return { error: "Choose a destination on the map." };
  const value = state.constraintType === "distance" ? Number(state.distanceKm) : Number(state.durationMin);
  if (!Number.isFinite(value) || value <= 0) return { error: `Enter a ${outingNoun(state.sport)} distance or time.` };
  if (state.constraintType === "distance" && (value < 2 || value > 300)) {
    return { error: "Choose a distance between 2 and 300 km." };
  }
  if (state.constraintType === "duration" && (value < 10 || value > 720)) {
    return { error: "Choose a time between 10 minutes and 12 hours." };
  }
  return {
    body: {
      area: state.area,
      routeType: state.routeType,
      sport: state.sport,
      start: state.start,
      ...(state.routeType === "point_to_point" ? { end: state.end } : {}),
      constraint: state.constraintType === "distance"
        ? { type: "distance", value: Math.round(value * 1000) }
        : { type: "duration", value: Math.round(value * 60) }
    }
  };
};

const pointRow = (kind, point, state) => {
  const label = kind === "start" ? "Start" : "Destination";
  const picking = state.picking === kind;
  return `
    <div class="route-planner-point${picking ? " is-picking" : ""}">
      <span>
        <small>${label}</small>
        <strong>${point ? escapeHtml(formatPoint(point)) : "Not set"}</strong>
      </span>
      <span class="route-planner-point-actions">
        <button type="button" data-exploration-pick="${kind}" aria-pressed="${picking}"${state.status !== "idle" || state.phase !== "configure" ? " disabled" : ""}>${picking ? "Click the map" : "Select on map"}</button>
        ${kind === "start" ? `<button type="button" data-exploration-locate${state.phase !== "configure" ? " disabled" : ""}>Locate me</button>` : ""}
      </span>
    </div>
  `;
};

const constraintControls = (state) => {
  const isDistance = state.constraintType === "distance";
  const presets = isDistance ? DISTANCE_PRESETS_KM : DURATION_PRESETS_MIN;
  const current = Number(isDistance ? state.distanceKm : state.durationMin);
  const disabled = state.phase !== "configure" ? " disabled" : "";
  return `
    <fieldset class="route-planner-constraint">
      <legend>Length</legend>
      <div class="route-planner-toggle" role="group" aria-label="Plan by">
        <button type="button" data-exploration-constraint="distance" aria-pressed="${isDistance}"${disabled}>Distance</button>
        <button type="button" data-exploration-constraint="duration" aria-pressed="${!isDistance}"${disabled}>Time</button>
      </div>
      <div class="route-planner-presets" role="group" aria-label="Presets">
        ${presets.map((preset) => `
          <button type="button" data-exploration-preset="${preset}" aria-pressed="${current === preset}"${disabled}>
            ${isDistance ? `${preset} km` : `${preset / 60} h`}
          </button>
        `).join("")}
      </div>
      <label class="route-planner-custom">
        <span>${isDistance ? "Custom km" : "Custom minutes"}</span>
        <input type="number" inputmode="decimal" data-exploration-custom
          min="${isDistance ? 2 : 10}" max="${isDistance ? 300 : 720}" step="${isDistance ? 1 : 5}"
          value="${escapeHtml(String(current))}"${disabled}>
      </label>
    </fieldset>
  `;
};

const rideSummary = (state) => {
  const sport = SPORT_OPTIONS.find((option) => option.value === state.sport)?.label ?? "";
  const length = state.constraintType === "distance" ? `${state.distanceKm} km` : formatRouteDuration(state.durationMin * 60);
  return `${sport ? `${sport} · ` : ""}${state.routeType === "round_trip" ? "Round trip" : "A to B"} · ${length}`;
};

/** One route proposal card; shows the edited version when the player customized it. */
export const RouteProposalCard = (state, original) => {
  const proposal = activeProposal(state, original.id);
  const selected = original.id === state.selectedProposalId;
  const updating = selected && state.status === "rerouting";
  const hint = proposal.hint ? proposalHints[proposal.hint] : undefined;
  return `
    <li>
      <button type="button" class="route-proposal${selected ? " is-selected" : ""}${updating ? " is-updating" : ""}"
        data-exploration-proposal="${escapeHtml(original.id)}" aria-pressed="${selected}"${state.status !== "idle" ? " disabled" : ""}>
        <span class="route-proposal-head">
          <strong>${proposalLabels[proposal.label] ?? "Route"}</strong>
          <small>${[
            proposal.recommended ? "Recommended" : "",
            hint ?? "",
            state.customizedById[original.id] ? "Customized" : ""
          ].filter(Boolean).join(" · ")}</small>
        </span>
        <span class="route-proposal-metrics">
          <span>${escapeHtml(formatRouteDistance(proposal.distanceM))}</span>
          <span>${escapeHtml(formatRouteDuration(proposal.durationS))}</span>
          ${Number.isFinite(proposal.elevationGainM) ? `<span>\u2191 ${Math.round(proposal.elevationGainM)} m</span>` : ""}
        </span>
        <span class="route-proposal-targets">${updating ? "Updating route..." : `
          <span data-proposal-destinations>${escapeHtml(targetSummaryText(proposal.targetSummary))}</span>
          ${traversedFlowlines(proposal).length ? `<span class="route-proposal-along" data-proposal-flowlines>Along this route: ${escapeHtml(flowlinesText(traversedFlowlines(proposal)))}</span>` : ""}`}</span>
      </button>
    </li>
  `;
};

const statusLine = (state) => {
  if (state.error) return `<p class="route-planner-error" role="alert">${escapeHtml(state.error)}</p>`;
  if (state.phase === "generating") return `<p class="route-planner-status" role="status">Finding routes for your ${outingNoun(state.sport)}...</p>`;
  if (state.status === "rerouting") return '<p class="route-planner-status" role="status">Updating route...</p>';
  if (state.phase === "confirming") return '<p class="route-planner-status" role="status">Starting exploration...</p>';
  if (state.adding) return '<p class="route-planner-status" role="status">Select a target on the map to add it to this route.</p>';
  if (state.picking === "start") return '<p class="route-planner-status" role="status">Click the map to set your start.</p>';
  if (state.picking === "end") return '<p class="route-planner-status" role="status">Click the map to set your destination.</p>';
  return "";
};

const panelHeader = (subtitle) => `
  <header>
    <div>
      <p class="world-detail-meta"><small>${escapeHtml(subtitle)}</small></p>
      <h2>Explore this Area</h2>
    </div>
    <button type="button" class="world-detail-close" data-exploration-cancel aria-label="Cancel exploration">\u2715</button>
  </header>
`;

/** CONFIGURE / GENERATING: only the ride. Targets are an internal planner detail at this point. */
const ConfigureStep = (state) => {
  const generating = state.phase === "generating";
  return `
    <section class="world-detail exploration-panel" aria-label="Explore this area">
      ${panelHeader("Step 1 · Plan your outing")}
      <form class="route-planner-form" data-exploration-form novalidate>
        <div class="route-planner-toggle" role="group" aria-label="Sport">
          ${SPORT_OPTIONS.map((option) => `<button type="button" data-exploration-sport="${option.value}" aria-pressed="${state.sport === option.value}"${generating ? " disabled" : ""}>${option.label}</button>`).join("")}
        </div>
        <div class="route-planner-toggle" role="group" aria-label="Route type">
          <button type="button" data-exploration-route-type="round_trip" aria-pressed="${state.routeType === "round_trip"}"${generating ? " disabled" : ""}>Round trip</button>
          <button type="button" data-exploration-route-type="point_to_point" aria-pressed="${state.routeType === "point_to_point"}"${generating ? " disabled" : ""}>A to B</button>
        </div>
        ${pointRow("start", state.start, state)}
        ${state.routeType === "point_to_point" ? pointRow("end", state.end, state) : ""}
        ${constraintControls(state)}
        ${generating
          ? '<button type="button" class="route-planner-submit" data-exploration-stop>Cancel</button>'
          : '<button type="submit" class="route-planner-submit" data-exploration-generate>Generate Routes</button>'}
      </form>
      ${statusLine(state)}
    </section>
  `;
};

const fitWarning = (proposal, sport) => {
  const noun = outingNoun(sport);
  if (proposal.constraintFit === "long") {
    return `<p class="route-planner-error exploration-warning" role="status">This route is longer than your planned ${noun}.</p>`;
  }
  if (proposal.constraintFit === "short") {
    return `<p class="route-planner-note exploration-warning" role="status">This route is shorter than your planned ${noun}.</p>`;
  }
  return "";
};

/** Server-reported planning warnings, e.g. the area cannot support the requested length. */
const warningsBlock = (state) => (state.warnings ?? []).map((warning) =>
  `<p class="route-planner-error exploration-warning" role="alert" data-exploration-warning="${escapeHtml(warning.code)}">${escapeHtml(warning.message)}</p>`).join("");

/** CUSTOMIZE: the selected route's contents, editable; every edit re-plans this route only. */
const CustomizeSection = (state) => {
  const proposal = activeProposal(state);
  if (!proposal) return "";
  const idle = state.status === "idle" && state.phase === "customize";
  const ids = state.pendingTargetIds ?? routeTargetIds(proposal);
  const atLimit = ids.length >= state.limits.maxRouteTargets;
  // Flowlines belong to the current geometry; hide them while an edit is being re-planned.
  const alongRoute = state.status === "rerouting" ? [] : traversedFlowlines(proposal);
  const dropped = (proposal.droppedTargetIds ?? []).map((id) => findCatalogTarget(state.catalog, id)?.name ?? id);
  return `
    <div class="exploration-targets" data-exploration-route-targets>
      <p class="exploration-target-count"><strong>Included destinations</strong></p>
      <ul class="exploration-selected" aria-label="Included destinations">
        ${ids.map((id) => {
          const target = findCatalogTarget(state.catalog, id);
          const name = target?.name ?? id;
          const icon = CollectibleSwatch({ category: target?.category, visited: target?.visited });
          return `
            <li data-exploration-target="${escapeHtml(id)}">
              <span class="exploration-target-name">${icon}<span data-user-content>${escapeHtml(name)}</span></span>
              <button type="button" data-exploration-remove="${escapeHtml(id)}"
                aria-label="Remove ${escapeHtml(name)} from this route"${!idle || ids.length <= 1 ? " disabled" : ""}>\u2715</button>
            </li>
          `;
        }).join("")}
      </ul>
      ${alongRoute.length ? `
        <p class="exploration-target-count"><strong>Along this route</strong> <small>${escapeHtml(flowlinesText(alongRoute))}</small></p>
        <ul class="exploration-along" aria-label="Along this route" data-exploration-along>
          ${alongRoute.map((flowline) => `
            <li data-exploration-flowline="${escapeHtml(flowline.id)}">
              <span class="exploration-target-name"><b class="fartlek-swatch" aria-hidden="true"></b><span data-user-content>${escapeHtml(flowline.name)}</span></span>
            </li>
          `).join("")}
        </ul>` : ""}
      ${dropped.length ? `<p class="route-planner-note">Couldn't route to ${escapeHtml(dropped.join(", "))}, so ${dropped.length === 1 ? "it was" : "they were"} left out.</p>` : ""}
      ${fitWarning(proposal, state.sport)}
      <div class="exploration-route-actions">
        <button type="button" data-exploration-add aria-pressed="${state.adding}"${!idle || (atLimit && !state.adding) ? " disabled" : ""}>
          ${state.adding ? "Done adding" : "Add destination"}</button>
        ${state.customizedById[state.selectedProposalId]
          ? `<button type="button" data-exploration-reset${idle ? "" : " disabled"}>Reset route</button>`
          : ""}
      </div>
      ${atLimit ? `<p class="route-planner-note">A route can include at most ${state.limits.maxRouteTargets} destinations.</p>` : ""}
      ${state.truncated ? '<p class="route-planner-note">This area has many targets. Zoom in to see all of them.</p>' : ""}
    </div>
  `;
};

/** PROPOSALS / CUSTOMIZE / CONFIRMING: generated routes, the selected route's contents and confirmation. */
const RouteStep = (state) => {
  const selected = activeProposal(state);
  return `
    <section class="world-detail exploration-panel" aria-label="Explore this area">
      ${panelHeader("Step 2 · Choose your route")}
      <div class="exploration-ride">
        <span>${escapeHtml(rideSummary(state))}</span>
        <button type="button" data-exploration-edit-ride${state.status === "idle" && state.phase !== "confirming" ? "" : " disabled"}>Change ride</button>
      </div>
      <ol class="route-proposals" aria-label="Route proposals">
        ${state.proposals.map((proposal) => RouteProposalCard(state, proposal)).join("")}
      </ol>
      ${warningsBlock(state)}
      ${selected ? CustomizeSection(state) : '<p class="route-planner-note">Choose a route to see what it includes.</p>'}
      ${statusLine(state)}
      <p class="route-planner-note">Routes are a planning aid. Progress only counts from your recorded activities after you start.</p>
      <button type="button" class="route-planner-confirm" data-exploration-confirm${!selected || state.status !== "idle" || state.phase !== "customize" ? " disabled" : ""}>Start Exploration</button>
    </section>
  `;
};

/** Explore this Area panel, rendered from the explicit exploration phase. Pure render. */
export const ExplorationPanel = (state) =>
  state.phase === "configure" || state.phase === "generating" ? ConfigureStep(state) : RouteStep(state);

/** Short summary of a stored PlannedRoute for a running exploration card. */
export const plannedRouteGpxUrl = (instanceId) => `/api/quest-instances/${encodeURIComponent(instanceId)}/planned-route.gpx`;

export const plannedRouteSummary = (route) =>
  `${formatRouteDistance(route.distanceM)} · ${formatRouteDuration(route.durationS)}${
    route.routeType === "round_trip" ? " · Round trip" : " · A to B"}`;
