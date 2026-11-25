import CoreLocation
import Foundation
import Observation

/// A stop of a manual route: an opportunity or completed Flowline, a collectible or a map point.
enum PlannerStop: Equatable, Identifiable, Sendable, Encodable {
    case flowline(WorldFlowline)
    case collectible(WorldCollectible)
    case waypoint(GeoPoint)

    enum Kind: String, Sendable { case flowline, collectible, waypoint }

    var kind: Kind {
        switch self {
        case .flowline: .flowline
        case .collectible: .collectible
        case .waypoint: .waypoint
        }
    }

    /// The id the server uses for this stop in `stopOrder` and the dropped lists.
    var key: String {
        switch self {
        case .flowline(let flowline): "flowline:\(flowline.id)"
        case .collectible(let collectible): collectible.id
        case .waypoint(let point): Self.waypointKey(point)
        }
    }

    var id: String { key }

    var points: [GeoPoint] {
        switch self {
        case .flowline(let flowline): flowline.coordinates.map { GeoPoint(lat: $0.latitude, lon: $0.longitude) }
        case .collectible(let item): [GeoPoint(lat: item.latitude, lon: item.longitude)]
        case .waypoint(let point): [point]
        }
    }

    static func waypointKey(_ point: GeoPoint) -> String {
        String(format: "waypoint:%.6f,%.6f", point.lat, point.lon)
    }

    private enum CodingKeys: String, CodingKey { case kind, id, lat, lon }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(kind.rawValue, forKey: .kind)
        switch self {
        case .flowline(let flowline): try container.encode(flowline.id, forKey: .id)
        case .collectible(let item): try container.encode(item.id, forKey: .id)
        case .waypoint(let point):
            try container.encode(point.lat, forKey: .lat)
            try container.encode(point.lon, forKey: .lon)
        }
    }
}

/// Route editor. "Generate route" proposes a route from the Explore session's opportunities; the player
/// can then edit every stop and Staza only connects them, ordering the stops unless the player
/// reordered them. "Save Exploration" persists the route as a planned Exploration; it never starts it.
@MainActor
@Observable
final class RoutePlannerModel {
    enum Status: Equatable { case idle, routing, suggesting, saving }
    enum RouteType: String { case roundTrip = "round_trip", pointToPoint = "point_to_point" }
    enum Sport: String, CaseIterable, Identifiable {
        case cycling, running, hiking
        var id: String { rawValue }
    }
    /// What the next empty-map tap does. With no active pick, it adds a waypoint.
    enum MapMode: Equatable { case pickStart, pickEnd }
    enum Failure: Equatable {
        case missingStart, missingEnd, noStops, noRoute, noSuggestion
        case server(String?)
    }

    private(set) var isActive = false
    private(set) var status = Status.idle
    private(set) var start: GeoPoint?
    private(set) var end: GeoPoint?
    private(set) var routeType = RouteType.roundTrip
    private(set) var sport = Sport.cycling
    /// The feel "Generate route" aims for; never saved with the Exploration.
    var intent = RouteIntent.default
    private(set) var stops: [PlannerStop] = []
    /// Set once the player reorders stops; Staza then routes them as given.
    private(set) var keepOrder = false
    /// Whether the stops are exactly what "Generate route" proposed, so replacing them loses no player choice.
    private(set) var stopsAreSuggested = false
    private(set) var mapMode: MapMode?
    /// The stop the player tapped in the list; the map highlights and centers it.
    private(set) var focusedStopKey: String?
    /// Bumped on every focus tap so re-tapping the focused stop centers it again.
    private(set) var focusRequest = 0
    /// The route for the current stops; every edit clears it.
    private(set) var proposal: RouteProposal?
    private(set) var failure: Failure?
    private(set) var plannedRoute: PlannedRoute?

    private let api: APIClient
    private var token = 0
    /// How long reordering or removing stops may pause before the shown route is recalculated.
    private let rerouteDelay: Duration
    private var reroute: Task<Void, Never>?

    init(api: APIClient, rerouteDelay: Duration = .milliseconds(800)) {
        self.api = api
        self.rerouteDelay = rerouteDelay
    }

    var isIdle: Bool { status == .idle }

    /// The route to draw: the planner's proposal, else the selected saved route.
    var displayedRoute: [CLLocationCoordinate2D] {
        proposal?.geometry.clCoordinates ?? plannedRoute?.geometry.clCoordinates ?? []
    }

    /// Stops the routed proposal had to leave out.
    var droppedStops: [PlannerStop] {
        guard let proposal else { return [] }
        let dropped = Set((proposal.droppedFlowlineIds ?? []).map { "flowline:\($0)" }
            + (proposal.droppedTargetIds ?? [])
            + (proposal.droppedWaypoints ?? []).map(PlannerStop.waypointKey))
        return stops.filter { dropped.contains($0.key) }
    }

    func contains(_ stop: PlannerStop) -> Bool { stops.contains { $0.key == stop.key } }

    var focusedStop: PlannerStop? { stops.first { $0.key == focusedStopKey } }

    /// Highlights a stop on the map and asks the map to center it.
    func focus(_ stop: PlannerStop) {
        guard contains(stop) else { return }
        focusedStopKey = stop.key
        focusRequest += 1
    }

    /// "Generate route" would replace stops the player chose, so it should ask first.
    var suggestReplacesOwnStops: Bool { !stops.isEmpty && !stopsAreSuggested }

    /// Opens the planner. Stops chosen with "Add to route" before are kept as route constraints.
    func open(start: GeoPoint?) {
        token += 1
        isActive = true
        status = .idle
        self.start = start
        end = nil
        routeType = .roundTrip
        keepOrder = false
        stopsAreSuggested = false
        mapMode = nil
        focusedStopKey = nil
        cancelReroute()
        proposal = nil
        failure = nil
        plannedRoute = nil
    }

    func close() {
        token += 1
        isActive = false
        status = .idle
        stops = []
        stopsAreSuggested = false
        mapMode = nil
        focusedStopKey = nil
        cancelReroute()
        proposal = nil
        failure = nil
        intent = .default
    }

    func setSport(_ sport: Sport) { edit { self.sport = sport } }

    func setRouteType(_ type: RouteType) {
        edit {
            routeType = type
            mapMode = type == .pointToPoint && end == nil ? .pickEnd : nil
        }
    }

    /// Toggles what the next map tap does.
    func toggleMapMode(_ mode: MapMode) {
        guard isIdle else { return }
        mapMode = mapMode == mode ? nil : mode
        failure = nil
    }

    func setStart(_ point: GeoPoint) {
        edit {
            start = point
            if mapMode == .pickStart { mapMode = nil }
        }
    }

    /// A map tap on empty ground: sets an explicitly picked endpoint or adds a waypoint.
    @discardableResult
    func mapTapped(_ point: GeoPoint) -> Bool {
        guard isActive, isIdle else { return false }
        switch mapMode {
        case .pickStart: setStart(point)
        case .pickEnd: edit { end = point; mapMode = nil }
        case nil: toggle(.waypoint(point))
        }
        return true
    }

    /// A Flowline or collectible tap adds/removes a stop unless the player is picking an endpoint.
    @discardableResult
    func mapSelected(_ stop: PlannerStop) -> Bool {
        guard isActive, isIdle, mapMode == nil else { return false }
        toggle(stop)
        return true
    }

    /// Adds or removes a stop. The player's route has no stop limits.
    func toggle(_ stop: PlannerStop) {
        guard isIdle else { return }
        if contains(stop) {
            remove(stop)
            return
        }
        edit {
            stops.append(stop)
            stopsAreSuggested = false
        }
    }

    func remove(_ stop: PlannerStop) {
        rerouting {
            stops.removeAll { $0.key == stop.key }
            stopsAreSuggested = false
            if focusedStopKey == stop.key { focusedStopKey = nil }
        }
    }

    func move(from source: IndexSet, to destination: Int) {
        rerouting {
            stops.move(fromOffsets: source, toOffset: destination)
            keepOrder = true
            stopsAreSuggested = false
        }
    }

    /// Lets Staza order the stops again.
    func autoOrder() { edit { keepOrder = false } }

    /// Connects the stops into one route; Staza's stop order is adopted unless the player set one.
    func route() async {
        cancelReroute()
        await performRoute()
    }

    private func performRoute() async {
        guard isIdle else { return }
        guard let start else { return fail(.missingStart) }
        guard routeType == .roundTrip || end != nil else { return fail(.missingEnd) }
        guard !stops.isEmpty, let area = Self.area(start: start, end: routeType == .pointToPoint ? end : nil, stops: stops) else { return fail(.noStops) }
        let request = PlanRequest(area: area, sport: sport.rawValue, start: start, routeType: routeType.rawValue,
                                  end: routeType == .pointToPoint ? end : nil, keepOrder: keepOrder, stops: stops)
        await run(.routing) { [self] in
            let result: PlannedExploration = try await api.post("/api/explorations/plan", body: request)
            proposal = result.proposal
            if let order = result.proposal.stopOrder, !keepOrder { stops = Self.ordered(stops, by: order) }
        }
    }

    /// "Generate route": proposes a route in the explored area. Its stops are the included collectibles and
    /// the opportunity Flowlines it rides; the player can edit them.
    func suggest(in bounds: WorldBounds, catalog: (String) -> WorldCollectible?) async {
        guard isIdle else { return }
        cancelReroute()
        guard let start else { return fail(.missingStart) }
        let request = SuggestRequest(area: PlanArea(bounds: bounds, zoom: 12), sport: sport.rawValue, start: start, intent: intent)
        await run(.suggesting, unroutable: .noSuggestion) { [self] in
            let result: GeneratedExploration = try await api.post("/api/explorations/generate", body: request)
            guard let suggestion = result.proposals.first else {
                failure = .noSuggestion
                return
            }
            let byId = Dictionary(result.catalog.collectibles.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            let ridden = Set((suggestion.traversedFlowlines ?? []).map(\.id))
            let flowlineStops = (result.catalog.flowlines ?? []).filter { !$0.completed && ridden.contains($0.id) }
            stops = suggestion.includedTargetIds.compactMap { byId[$0] ?? catalog($0) }.map(PlannerStop.collectible)
                + flowlineStops.map(PlannerStop.flowline)
            keepOrder = false
            stopsAreSuggested = true
            focusedStopKey = nil
            routeType = .roundTrip
            proposal = suggestion
        }
    }

    /// "Save Exploration": persists the routed plan as a planned QuestInstance with its PlannedRoute and
    /// closes the planner. Starting it is a separate action in the Explorations list.
    @discardableResult
    func save() async -> Bool {
        guard isIdle, let proposal else { return false }
        var saved = false
        await run(.saving) { [self] in
            let _: SavedExploration = try await api.post("/api/explorations/save", body: SaveRequest(proposalId: proposal.id))
            close()
            saved = true
        }
        return saved
    }

    /// Shows the planned route of the first exploration that has one.
    func loadPlannedRoute(instanceIds: [String]) async {
        guard !isActive else { return }
        for id in instanceIds {
            if let route: PlannedRoute = try? await api.get("/api/quest-instances/\(id)/planned-route") {
                if !isActive { plannedRoute = route }
                return
            }
        }
    }

    func clearPlannedRoute() { plannedRoute = nil }

    /// Shows an already loaded planned route unless a route is being planned.
    func showPlannedRoute(_ route: PlannedRoute?) {
        guard !isActive else { return }
        plannedRoute = route
    }

    /// Stops in the order the server routed them; stops it did not mention keep their place at the end.
    static func ordered(_ stops: [PlannerStop], by order: [String]) -> [PlannerStop] {
        let rank = Dictionary(order.enumerated().map { ($1, $0) }, uniquingKeysWith: { first, _ in first })
        return stops.enumerated().sorted { left, right in
            let (l, r) = (rank[left.element.key] ?? .max, rank[right.element.key] ?? .max)
            return l != r ? l < r : left.offset < right.offset
        }.map(\.element)
    }

    /// A planning area containing the start, end and every stop, padded so routing has room.
    static func area(start: GeoPoint, end: GeoPoint?, stops: [PlannerStop]) -> PlanArea? {
        let points = [start] + (end.map { [$0] } ?? []) + stops.flatMap(\.points)
        let lats = points.map(\.lat), lons = points.map(\.lon)
        guard let minLat = lats.min(), let maxLat = lats.max(), let minLon = lons.min(), let maxLon = lons.max() else { return nil }
        let padLat = max(0.01, (maxLat - minLat) * 0.2)
        let padLon = max(0.015, (maxLon - minLon) * 0.2)
        return PlanArea(bounds: WorldBounds(west: minLon - padLon, south: minLat - padLat, east: maxLon + padLon, north: maxLat + padLat))
    }

    private func edit(_ change: () -> Void) {
        guard isIdle else { return }
        change()
        proposal = nil
        failure = nil
    }

    /// An edit that keeps a calculated route current: after a short pause without further edits, the
    /// remaining stops are routed again, so several quick moves trigger only one request.
    private func rerouting(_ change: () -> Void) {
        guard isIdle else { return }
        let wasRouted = proposal != nil || reroute != nil
        edit(change)
        cancelReroute()
        guard wasRouted, !stops.isEmpty else { return }
        reroute = Task { [weak self, rerouteDelay] in
            try? await Task.sleep(for: rerouteDelay)
            guard let self, !Task.isCancelled else { return }
            reroute = nil
            await performRoute()
        }
    }

    private func cancelReroute() {
        reroute?.cancel()
        reroute = nil
    }

    private func fail(_ failure: Failure) { self.failure = failure }

    /// `unroutable` is the failure shown when the server finds no route (422).
    private func run(_ running: Status, unroutable: Failure = .noRoute, _ work: () async throws -> Void) async {
        token += 1
        let current = token
        status = running
        failure = nil
        mapMode = nil
        do {
            try await work()
            if current == token || !isActive { status = .idle }
        } catch is CancellationError {
            if current == token { status = .idle }
        } catch {
            guard current == token else { return }
            status = .idle
            failure = Self.failure(for: error, unroutable: unroutable)
            if Self.isExpired(error) { proposal = nil }
        }
    }

    private static func failure(for error: Error, unroutable: Failure) -> Failure {
        guard case APIError.server(let status, let message, _) = error else { return .server(nil) }
        return status == 422 ? unroutable : .server(message)
    }

    private static func isExpired(_ error: Error) -> Bool {
        if case APIError.server(_, _, let code) = error { return code == "proposal_expired" || code == "exploration_expired" }
        return false
    }
}
