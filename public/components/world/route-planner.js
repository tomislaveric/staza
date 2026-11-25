import { escapeHtml } from "../collected-list.js";
import { CollectibleSwatch } from "./collectible-swatch.js";
import { formatRouteDistance, formatRouteDuration, SPORT_OPTIONS } from "./route-format.js";

/**
 * What a generated route should feel like. Never named after speed: Staza does not optimize pace.
 * The names stay Glide / Chill / Explore (Glide, so it never clashes with the Flow score) in every language. Chill is the default; the choice is
 * not saved with the Exploration.
 */
export const ROUTE_INTENTS = [
  { value: "flow", label: "Glide", description: "Smooth Flowlines, few interruptions." },
  { value: "chill", label: "Chill", description: "A relaxed, moderate mix." },
  { value: "explore", label: "Explore", description: "A few good places, small detours." }
];
export const DEFAULT_ROUTE_INTENT = "chill";

/** The intent picker shared by the Explore card and the planner; `attribute` names the click target. */
export const IntentPicker = (selected, attribute, { disabled = false } = {}) => `
  <div class="route-intent-picker" role="group" aria-label="Route feel">
    ${ROUTE_INTENTS.map((intent) => `
      <button type="button" ${attribute}="${intent.value}" aria-pressed="${selected === intent.value}"${disabled ? " disabled" : ""}>
        <strong translate="no">${escapeHtml(intent.label)}</strong>
        <small>${escapeHtml(intent.description)}</small>
      </button>`).join("")}
  </div>
`;

/**
 * The route planner as a short wizard: pick a sport, pick a shape, and Staza generates Glide, Chill
 * and Explore for the planning area in one request. Choosing one turns its stops into the editable
 * stop list; every later edit reroutes. Saving is the only persistence step.
 * - `sportChosen` / `shapeChosen`: the wizard steps the player completed; `stepsOpen` shows them again.
 * - `alternatives`: the generated routes (each with `intent`), `chosenIntent` the one being edited.
 * - `stopsAreSuggested`: the stops are exactly the chosen route's; own edits clear it.
 * - `adding`: "flowline" | "collectible" | "waypoint" while the map adds that kind of stop.
 * - `picking`: "start" | "end" while the map sets that endpoint.
 * - `status`: "idle" | "routing" | "generating" | "saving".
 * - `proposal`: the routed result for the current stops; cleared by every edit.
 * - `generatedArea`: the bbox the alternatives were generated for; `areaMoved` once the map left it.
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
  alternatives: [],
  chosenIntent: undefined,
  catalog: undefined,
  generatedArea: undefined,
  areaMoved: false,
  rerouteQueued: false,
  dropped: [],
  error: undefined
});

export const stepsDone = (state) => state.sportChosen && state.shapeChosen;

/** Sport, shape, start (and end for A to B) are known, so the three routes can be generated. */
export const canGenerate = (state) => Boolean(stepsDone(state) && state.start && (state.routeType !== "point_to_point" || state.end));

/** Stops are editable once a route is chosen or the player already has stops of their own. */
export const canEditStops = (state) => Boolean(state.chosenIntent || state.proposal || state.stops.length);

/** The generated routes not currently chosen. */
export const otherAlternatives = (state) => state.chosenIntent
  ? state.alternatives.filter((route) => route.intent !== state.chosenIntent)
  : state.alternatives;

/** Generated routes in Glide, Chill, Explore order. */
export const orderAlternatives = (proposals = []) => {
  const rank = (proposal) => {
    const index = ROUTE_INTENTS.findIndex((intent) => intent.value === proposal.intent);
    return index < 0 ? ROUTE_INTENTS.length : index;
  };
  return [...proposals].sort((left, right) => rank(left) - rank(right));
};

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

const parseBbox = (bbox) => bbox.split(",").map(Number);

/** The area grown (with a small margin) so it contains `point`; the server rejects an end outside the area. */
export const areaIncluding = (area, point) => {
  const [west, south, east, north] = parseBbox(area.bbox);
  if (!point || (point.lon >= west && point.lon <= east && point.lat >= south && point.lat <= north)) return area;
  const padLat = Math.max(0.01, (north - south) * 0.05);
  const padLon = Math.max(0.015, (east - west) * 0.05);
  const round = (value) => Number(value.toFixed(6));
  const bounds = [
    Math.min(west, point.lon - padLon), Math.min(south, point.lat - padLat),
    Math.max(east, point.lon + padLon), Math.max(north, point.lat + padLat)
  ].map(round);
  return { ...area, bbox: bounds.join(","), center: { lat: round((bounds[1] + bounds[3]) / 2), lon: round((bounds[0] + bounds[2]) / 2) } };
};

/** Generates Glide, Chill and Explore for the planning area in one request. */
export const buildSuggestRequest = (state, area) => {
  if (!state.start) return { error: "Choose a start on the map." };
  const pointToPoint = state.routeType === "point_to_point";
  if (pointToPoint && !state.end) return { error: "Choose an end point on the map." };
  return {
    body: {
      area: pointToPoint ? areaIncluding(area, state.end) : area,
      sport: state.sport,
      start: state.start,
      routeType: state.routeType,
      ...(pointToPoint ? { end: state.end } : {}),
      intents: ROUTE_INTENTS.map((intent) => intent.value)
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

/**
 * Whether the visible map clearly left the area the routes were generated for: its center lies
 * outside that area, or the player zoomed out to more than twice its width. Zooming in never counts.
 */
export const areaMoved = (generatedBbox, bounds) => {
  if (!generatedBbox || !bounds) return false;
  const [west, south, east, north] = parseBbox(generatedBbox);
  const centerLat = (bounds.south + bounds.north) / 2;
  const centerLon = (bounds.west + bounds.east) / 2;
  if (centerLat < south || centerLat > north || centerLon < west || centerLon > east) return true;
  return bounds.east - bounds.west > 2 * (east - west);
};

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
  if (state.status === "generating") return '<p class="route-planner-status" role="status">Generating Glide, Chill and Explore\u2026</p>';
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

const intentInfo = (intent) => ROUTE_INTENTS.find((item) => item.value === intent);

const metrics = (proposal) => `
  <p class="route-proposal-metrics">
    <span>${escapeHtml(formatRouteDistance(proposal.distanceM))}</span>
    <span>${escapeHtml(formatRouteDuration(proposal.durationS))}</span>
    ${Number.isFinite(proposal.elevationGainM) ? `<span>\u2191 ${Math.round(proposal.elevationGainM)} m</span>` : ""}
  </p>`;

/** One generated route as a tappable row; `compact` once another route is chosen. */
const alternativeRow = (proposal, idle, compact) => {
  const info = intentInfo(proposal.intent);
  return `
    <li>
      <button type="button" class="route-planner-alternative${compact ? " is-compact" : ""}" data-planner-choose="${escapeHtml(proposal.intent ?? "")}"${idle ? "" : " disabled"}>
        <strong translate="no">${escapeHtml(info?.label ?? "Route")}</strong>
        <span>${escapeHtml(formatRouteDistance(proposal.distanceM))} \u00b7 ${escapeHtml(formatRouteDuration(proposal.durationS))}</span>
        ${compact ? "" : `<small>${escapeHtml(info?.description ?? "")}</small>`}
      </button>
    </li>`;
};

/** The chosen (or own) route: metrics and Save, shown above the stops. */
const chosenCard = (state, dropped, idle) => {
  const info = intentInfo(state.chosenIntent);
  const { proposal } = state;
  return `
    <div class="route-planner-result" data-planner-result>
      <p class="route-planner-chosen-title"><strong translate="no">${escapeHtml(info?.label ?? "Your route")}</strong>${state.chosenIntent && !state.stopsAreSuggested ? " <small>Edited</small>" : ""}</p>
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
  const chosen = Boolean(state.chosenIntent || state.proposal);
  const others = otherAlternatives(state);
  const ownStopsUnrouted = !state.chosenIntent && !state.proposal && state.stops.length > 0;
  return `
    <section class="world-detail exploration-panel route-planner" aria-label="Plan a route">
      <header>
        <div>
          <p class="world-detail-meta"><small>Sport, shape, done: Staza suggests three routes</small></p>
          <h2>Plan a route</h2>
        </div>
        <button type="button" class="world-detail-close" data-planner-close aria-label="Close route planner">\u2715</button>
      </header>
      ${wizardSteps(state, idle)}
      ${pointRow("start", "Start", state, idle)}
      ${state.routeType === "point_to_point" ? pointRow("end", "End", state, idle) : ""}
      ${!state.alternatives.length && !chosen && idle ? '<p class="route-planner-note" data-planner-area>Routes are planned for the visible map area.</p>' : ""}
      ${state.areaMoved && idle ? '<button type="button" class="route-planner-regenerate" data-planner-regenerate>Generate here</button>' : ""}
      ${statusLine(state)}
      ${state.error && (state.stops.length || canGenerate(state)) ? `<button type="button" data-planner-retry${idle ? "" : " disabled"}>Try again</button>` : ""}
      ${chosen ? chosenCard(state, dropped, idle) : ""}
      ${others.length ? `
        ${chosen ? '<p class="route-planner-heading">Other routes</p>' : '<p class="route-planner-heading">Pick a route</p>'}
        <ol class="route-planner-routes" aria-label="${chosen ? "Other routes" : "Routes"}">
          ${others.map((proposal) => alternativeRow(proposal, idle, chosen)).join("")}
        </ol>` : ""}
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
