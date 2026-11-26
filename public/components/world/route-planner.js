import { escapeHtml } from "../collected-list.js";
import { CollectibleSwatch } from "./collectible-swatch.js";
import { formatRouteDistance, formatRouteDuration, SPORT_OPTIONS } from "./route-format.js";

/**
 * The route planner as a short wizard: pick a sport, pick a shape, and Staza generates one route
 * towards the aimed target (the map center). Its stops become the editable stop list; every later
 * edit reroutes. Saving is the only persistence step.
 * - `sportChosen` / `shapeChosen`: the wizard steps the player completed; `stepsOpen` shows them again.
 * - `generated`: Staza generated the current route (possibly edited since).
 * - `stopsAreSuggested`: the stops are exactly the generated route's; own edits clear it.
 * - `adding`: "flowline" | "collectible" | "waypoint" while the map adds that kind of stop.
 * - `picking`: "start" | "end" while the map sets that endpoint.
 * - `status`: "idle" | "routing" | "generating" | "saving".
 * - `proposal`: the routed result for the current stops; cleared by every edit.
 */
export const createPlannerState = ({ start, stops = [], sport, routeType } = {}) => ({
  start,
  end: undefined,
  routeType: routeType ?? "round_trip",
  sport: sport ?? "cycling",
  sportChosen: Boolean(sport),
  shapeChosen: Boolean(routeType),
  stepsOpen: !(sport && routeType),
  picking: start ? undefined : "start",
  stops: [...stops],
  stopsAreSuggested: false,
  adding: undefined,
  keepOrder: false,
  status: "idle",
  proposal: undefined,
  generated: false,
  catalog: undefined,
  rerouteQueued: false,
  dropped: [],
  error: undefined
});

export const stepsDone = (state) => state.sportChosen && state.shapeChosen;

/** Sport, shape, start (and end for A to B) are known, so a route can be generated. */
/** An A to B route without a picked end ends at the crosshair. */
export const canGenerate = (state) => Boolean(stepsDone(state) && state.start);

/** Stops are editable once a route exists or the player already has stops of their own. */
export const canEditStops = (state) => Boolean(state.generated || state.proposal || state.stops.length);

export const waypointKey = (point) => `waypoint:${point.lat.toFixed(6)},${point.lon.toFixed(6)}`;

/** The id the server uses for a stop in `stopOrder` and the dropped lists. */
export const stopKey = (stop) => stop.kind === "flowline" ? `flowline:${stop.id}`
  : stop.kind === "waypoint" ? waypointKey(stop) : stop.id;

export const flowlineStop = (flowline) => ({
  kind: "flowline", id: flowline.id, name: flowline.name, coordinates: flowline.geometry?.coordinates ?? []
});

export const collectibleStop = (collectible) => ({
  kind: "collectible",
  id: collectible.id,
  name: collectible.name,
  category: collectible.primaryCategory ?? collectible.type,
  visited: Boolean(collectible.found),
  lat: collectible.latitude,
  lon: collectible.longitude
});

export const waypointStop = (point) => ({ kind: "waypoint", lat: point.lat, lon: point.lon });

export const hasStop = (stops, stop) => stops.some((item) => stopKey(item) === stopKey(stop));

/** Adds or removes a stop. The player's route has no stop limits. */
export const toggleStop = (stops, stop) =>
  hasStop(stops, stop) ? stops.filter((item) => stopKey(item) !== stopKey(stop)) : [...stops, stop];

export const moveStop = (stops, index, offset) => {
  const target = index + offset;
  if (index < 0 || target < 0 || target >= stops.length) return stops;
  const next = [...stops];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
};

/** Stops in the order the server routed them; stops it did not mention keep their place at the end. */
export const orderStops = (stops, stopOrder = []) => {
  const rank = new Map(stopOrder.map((key, index) => [key, index]));
  return [...stops].sort((left, right) => (rank.get(stopKey(left)) ?? Infinity) - (rank.get(stopKey(right)) ?? Infinity));
};

const stopPoints = (stop) => stop.kind === "flowline" ? stop.coordinates.map(([lon, lat]) => ({ lat, lon })) : [{ lat: stop.lat, lon: stop.lon }];

/** A planning area that contains the start, end and every stop, padded so routing has room. */
export const planArea = (state) => {
  const points = [state.start, state.routeType === "point_to_point" ? state.end : undefined, ...state.stops.flatMap(stopPoints)]
    .filter((point) => point && Number.isFinite(point.lat) && Number.isFinite(point.lon));
  if (!points.length) return undefined;
  const lats = points.map((point) => point.lat);
  const lons = points.map((point) => point.lon);
  const padLat = Math.max(0.01, (Math.max(...lats) - Math.min(...lats)) * 0.2);
  const padLon = Math.max(0.015, (Math.max(...lons) - Math.min(...lons)) * 0.2);
  const west = Math.min(...lons) - padLon;
  const south = Math.min(...lats) - padLat;
  const east = Math.max(...lons) + padLon;
  const north = Math.max(...lats) + padLat;
  const round = (value) => Number(value.toFixed(6));
  return {
    bbox: [west, south, east, north].map(round).join(","),
    center: { lat: round((south + north) / 2), lon: round((west + east) / 2) },
    zoom: 11
  };
};

const rideBody = (state) => ({
  sport: state.sport,
  start: state.start,
  routeType: state.routeType,
  ...(state.routeType === "point_to_point" ? { end: state.end } : {})
});

/** Validates the plan and builds the `POST /api/explorations/plan` body. */
export const buildPlanRequest = (state) => {
  if (!state.start) return { error: "Choose a start on the map." };
  if (state.routeType === "point_to_point" && !state.end) return { error: "Choose an end point on the map." };
  if (!state.stops.length) return { error: "Add a Flowline, collectible or map point first." };
  return {
    body: {
      area: planArea(state),
      ...rideBody(state),
      keepOrder: state.keepOrder,
      stops: state.stops.map((stop) => stop.kind === "waypoint"
        ? { kind: "waypoint", lat: stop.lat, lon: stop.lon }
        : { kind: stop.kind, id: stop.id })
    }
  };
};

/**
 * Generates one route towards the aimed target: a round trip rides
 * to `aim` and back, an A to B route ends at the picked end, else at `aim`.
 */
export const buildSuggestRequest = (state, aim) => {
  if (!state.start) return { error: "Choose a start on the map." };
  const pointToPoint = state.routeType === "point_to_point";
  return {
    body: {
      target: pointToPoint ? state.end ?? aim : aim,
      sport: state.sport,
      start: state.start,
      routeType: state.routeType
    }
  };
};

/** A generated route's stops: its included collectibles and the unridden Flowlines it rides. */
export const suggestedStops = (proposal, catalog = {}) => {
  const flowlines = new Map((catalog.flowlines ?? []).filter((flowline) => !flowline.completed).map((flowline) => [flowline.id, flowline]));
  const collectibles = new Map((catalog.collectibles ?? []).map((collectible) => [collectible.id, collectible]));
  return [
    ...(proposal.includedTargetIds ?? []).map((id) => collectibles.get(id)).filter(Boolean).map(collectibleStop),
    ...[...new Set((proposal.traversedFlowlines ?? []).map((flowline) => flowline.id))]
      .map((id) => flowlines.get(id)).filter(Boolean).map(flowlineStop)
  ];
};

/** The crosshair marks the target until a route exists: a round trip's turning point or an A to B route's end. */
export const showsAim = (state) => (state.routeType === "round_trip" || !state.end)
  && !state.generated && !state.proposal;

/** Names of stops the routed proposal had to leave out. */
export const droppedStops = (stops, proposal) => {
  if (!proposal) return [];
  const dropped = new Set([
    ...(proposal.droppedFlowlineIds ?? []).map((id) => `flowline:${id}`),
    ...(proposal.droppedTargetIds ?? []),
    ...(proposal.droppedWaypoints ?? []).map(waypointKey)
  ]);
  return stops.filter((stop) => dropped.has(stopKey(stop)));
};

const stopName = (stop) => stop.kind === "waypoint" ? `Map point ${stop.lat.toFixed(4)}, ${stop.lon.toFixed(4)}` : stop.name;

const stopIcon = (stop) => stop.kind === "flowline" ? '<b class="fartlek-swatch" aria-hidden="true"></b>'
  : stop.kind === "collectible" ? CollectibleSwatch({ category: stop.category, visited: stop.visited })
    : '<b class="route-planner-waypoint" aria-hidden="true"></b>';

const formatPoint = (point) => point ? `${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}` : "Not set";

const statusLine = (state) => {
  if (state.error) return `<p class="route-planner-error" role="alert">${escapeHtml(state.error)}</p>`;
  if (state.status === "routing" || state.rerouteQueued) return '<p class="route-planner-status" role="status">Updating the route\u2026</p>';
  if (state.status === "generating") return '<p class="route-planner-status" role="status">Finding a route\u2026</p>';
  if (state.status === "saving") return '<p class="route-planner-status" role="status">Saving exploration\u2026</p>';
  if (state.picking === "start") return '<p class="route-planner-status" role="status">Click the map to set your start.</p>';
  if (state.picking === "end") return '<p class="route-planner-status" role="status">Click the map to set your end point.</p>';
  if (state.adding === "flowline") return '<p class="route-planner-status" role="status">Select a Flowline on the map.</p>';
  if (state.adding === "collectible") return '<p class="route-planner-status" role="status">Select a collectible on the map.</p>';
  if (state.adding === "waypoint") return '<p class="route-planner-status" role="status">Click the map to add a waypoint.</p>';
  return "";
};

const pointRow = (kind, label, state, idle) => `
  <div class="route-planner-point${state.picking === kind ? " is-picking" : ""}">
    <span><small>${label}</small> <strong>${escapeHtml(formatPoint(state[kind]))}</strong></span>
    <span class="route-planner-point-actions">
      <button type="button" data-planner-pick="${kind}" aria-pressed="${state.picking === kind}"${idle ? "" : " disabled"}>${state.picking === kind ? "Click the map" : "Select on map"}</button>
      ${kind === "start" ? `<button type="button" data-planner-locate${idle ? "" : " disabled"}>Locate me</button>` : ""}
    </span>
  </div>
`;

const addLabels = { flowline: "Add Flowline", collectible: "Add Collectible", waypoint: "Add waypoint" };

const SPORT_ICONS = { cycling: "\u{1F6B2}", running: "\u{1F3C3}", hiking: "\u{1F97E}" };
export const ROUTE_SHAPES = [
  { value: "round_trip", label: "Roundtrip", icon: "\u27F3" },
  { value: "point_to_point", label: "A \u2192 B", icon: "\u2192" }
];

const choiceButton = (attribute, value, icon, label, pressed, idle) => `
  <button type="button" class="route-planner-choice" ${attribute}="${value}" aria-pressed="${pressed}"${idle ? "" : " disabled"}>
    <span class="route-planner-choice-icon" aria-hidden="true">${icon}</span><span>${escapeHtml(label)}</span>
  </button>`;

/** Sport and shape as icon choices, or one summary row once both are chosen. */
const wizardSteps = (state, idle) => {
  const sport = SPORT_OPTIONS.find((option) => option.value === state.sport) ?? SPORT_OPTIONS[0];
  const shape = ROUTE_SHAPES.find((option) => option.value === state.routeType) ?? ROUTE_SHAPES[0];
  if (stepsDone(state) && !state.stepsOpen) {
    return `
      <div class="route-planner-summary">
        <span><span aria-hidden="true">${SPORT_ICONS[sport.value]}</span> ${escapeHtml(sport.label)} \u00b7 <span aria-hidden="true">${shape.icon}</span> ${escapeHtml(shape.label)}</span>
        <button type="button" data-planner-steps${idle ? "" : " disabled"}>Change</button>
      </div>`;
  }
  return `
    <div class="route-planner-step" role="group" aria-label="Sport">
      <small>Sport</small>
      <div class="route-planner-choices">
        ${SPORT_OPTIONS.map((option) => choiceButton("data-planner-sport", option.value, SPORT_ICONS[option.value], option.label, state.sportChosen && state.sport === option.value, idle)).join("")}
      </div>
    </div>
    <div class="route-planner-step" role="group" aria-label="Route shape">
      <small>Route shape</small>
      <div class="route-planner-choices">
        ${ROUTE_SHAPES.map((option) => choiceButton("data-planner-shape", option.value, option.icon, option.label, state.shapeChosen && state.routeType === option.value, idle)).join("")}
      </div>
    </div>`;
};

const metrics = (proposal) => `
  <p class="route-proposal-metrics">
    <span>${escapeHtml(formatRouteDistance(proposal.distanceM))}</span>
    <span>${escapeHtml(formatRouteDuration(proposal.durationS))}</span>
    ${Number.isFinite(proposal.elevationGainM) ? `<span>\u2191 ${Math.round(proposal.elevationGainM)} m</span>` : ""}
  </p>`;

/** The generated (or own) route: metrics and Save, shown above the stops. */
const routeCard = (state, dropped, idle) => {
  const { proposal } = state;
  return `
    <div class="route-planner-result" data-planner-result>
      <p class="route-planner-chosen-title"><strong>${state.generated ? "Suggested route" : "Your route"}</strong>${state.generated && !state.stopsAreSuggested ? " <small>Edited</small>" : ""}</p>
      ${proposal ? metrics(proposal) : ""}
      ${proposal && dropped.length ? `<p class="route-planner-note">Couldn't route ${escapeHtml(dropped.map(stopName).join(", "))}, so ${dropped.length === 1 ? "it was" : "they were"} left out.</p>` : ""}
      ${proposal ? `
        <p class="route-planner-note">Saving keeps this route on your World. Start it whenever you go; progress only counts from activities after you start.</p>
        <button type="button" class="route-planner-confirm" data-planner-save${idle && !state.rerouteQueued ? "" : " disabled"}>Save Exploration</button>` : ""}
    </div>`;
};

const stopList = (state, dropped, idle) => state.stops.length ? `
  <ol class="exploration-selected route-planner-stops" aria-label="Route stops" data-planner-stops>
    ${state.stops.map((stop, index) => `
      <li data-planner-stop="${escapeHtml(stopKey(stop))}"${dropped.includes(stop) ? ' class="is-dropped"' : ""}>
        <span class="exploration-target-name">${stopIcon(stop)}<span data-user-content>${escapeHtml(stopName(stop))}</span></span>
        <span class="route-planner-stop-actions">
          <button type="button" data-planner-move="${index}:-1" aria-label="Move ${escapeHtml(stopName(stop))} up"${idle && index > 0 ? "" : " disabled"}>\u2191</button>
          <button type="button" data-planner-move="${index}:1" aria-label="Move ${escapeHtml(stopName(stop))} down"${idle && index < state.stops.length - 1 ? "" : " disabled"}>\u2193</button>
          <button type="button" data-planner-remove="${index}" aria-label="Remove ${escapeHtml(stopName(stop))}"${idle ? "" : " disabled"}>\u2715</button>
        </span>
      </li>`).join("")}
  </ol>
  <p class="route-planner-note">${state.keepOrder ? "Your order is kept." : "Staza orders the stops; move one to keep your own order."}</p>`
  : '<p class="route-planner-note">Add Flowlines, collectibles or waypoints. Staza only connects what you choose.</p>';

/** The wizard planner panel. Pure render. */
export const RoutePlannerPanel = (state) => {
  const idle = state.status === "idle";
  const dropped = droppedStops(state.stops, state.proposal);
  const routed = Boolean(state.generated || state.proposal);
  const ownStopsUnrouted = !routed && state.stops.length > 0;
  return `
    <section class="world-detail exploration-panel route-planner" aria-label="Plan a route">
      <header>
        <div>
          <p class="world-detail-meta"><small>Sport, shape, done: Staza suggests a route</small></p>
          <h2>Plan a route</h2>
        </div>
        <button type="button" class="world-detail-close" data-planner-close aria-label="Close route planner">\u2715</button>
      </header>
      ${wizardSteps(state, idle)}
      ${pointRow("start", "Start", state, idle)}
      ${state.routeType === "point_to_point" && (state.end || state.picking === "end") ? pointRow("end", "End", state, idle) : ""}
      ${showsAim(state) && idle ? `<p class="route-planner-note" data-planner-area>${state.routeType === "round_trip" ? "Routes ride to the crosshair in the map center and back." : "The route ends at the crosshair in the map center."}</p>` : ""}
      ${statusLine(state)}
      ${state.error && (state.stops.length || canGenerate(state)) ? `<button type="button" data-planner-retry${idle ? "" : " disabled"}>Try again</button>` : ""}
      ${routed ? routeCard(state, dropped, idle) : ""}
      ${canEditStops(state) ? `
        ${stopList(state, dropped, idle)}
        <div class="exploration-route-actions route-planner-add" role="group" aria-label="Add stops">
          ${Object.entries(addLabels).map(([kind, label]) => `<button type="button" data-planner-add="${kind}" aria-pressed="${state.adding === kind}"${idle ? "" : " disabled"}>${label}</button>`).join("")}
        </div>` : ""}
      ${ownStopsUnrouted && !state.error ? `
        <div class="route-planner-commands">
          <button type="button" class="route-planner-submit" data-planner-route${idle && state.start ? "" : " disabled"}>Route my stops</button>
        </div>` : ""}
    </section>
  `;
};
