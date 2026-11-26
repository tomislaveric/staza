import CoreLocation
import Foundation
import Observation

/// A stop of a manual route: a curated POI or a map point.
enum PlannerStop: Equatable, Identifiable, Sendable, Encodable {
    case collectible(WorldCollectible)
    case waypoint(GeoPoint)

    enum Kind: String, Sendable { case collectible, waypoint }

    var kind: Kind {
        switch self {
        case .collectible: .collectible
        case .waypoint: .waypoint
        }
    }

    /// The id the server uses for this stop in `stopOrder` and the dropped lists.
    var key: String {
        switch self {
        case .collectible(let collectible): collectible.id
        case .waypoint(let point): Self.waypointKey(point)
        }
    }

    var id: String { key }

    var points: [GeoPoint] {
        switch self {
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
        case .collectible(let item): try container.encode(item.id, forKey: .id)
        case .waypoint(let point):
            try container.encode(point.lat, forKey: .lat)
            try container.encode(point.lon, forKey: .lon)
        }
    }
}

/// Explore: the player picks a sport and a route shape, then Staza generates one Flowline-free route
/// towards the aim or a chosen POI. The player can edit its stops and Staza reroutes, ordering them
/// unless the player reordered them. Cycling routes then offer a few nearby Flowlines as optional
/// enhancements. "Save Exploration" persists the route as a planned Exploration; it never starts it.
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

    private(set) var status = Status.idle
    private(set) var start: GeoPoint?
    private(set) var end: GeoPoint?
    private(set) var destination: GeoPoint?
    private(set) var destinationId: String?
    private(set) var destinationName: String?
    private(set) var routeType = RouteType.roundTrip
    private(set) var sport = Sport.cycling
    /// Wizard steps: generation starts once both are chosen.
    private(set) var sportChosen = false
    private(set) var shapeChosen = false
    /// The player reopened the collapsed steps to change a choice.
    private(set) var stepsOpen = false
    /// Staza generated the current route (possibly edited since); its route is `proposal`.
    private(set) var generated = false
    /// Bumped whenever the wizard is ready to generate; the view answers with `generate(toward:)`.
    private(set) var generateRequest = 0
    private var catalog: ExplorationCatalog?
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
    private(set) var baselineProposal: RouteProposal?
    private(set) var explorationId: String?
    private(set) var flowlineEnhancements: [FlowlineEnhancementOption] = []
    private(set) var selectedEnhancementIds: Set<String> = []
    private(set) var enhancementMetrics: FlowlineEnhancementMetrics?
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
        let dropped = Set((proposal.droppedTargetIds ?? [])
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

    /// Choosing a generated route would replace stops the player chose, so it should ask first.
    var suggestReplacesOwnStops: Bool { !stops.isEmpty && !stopsAreSuggested }

    /// Sport and shape are chosen.
    var stepsDone: Bool { sportChosen && shapeChosen }

    /// The step pickers show until both are chosen or while reopened; else a summary row replaces them.
    var showsSteps: Bool { !stepsDone || stepsOpen }

    /// Everything generation needs is known; an A→B route without a picked end ends at the aim.
    var canGenerate: Bool { stepsDone && start != nil }

    /// Map taps edit stops only once a route is chosen (or the player builds one from own stops).
    var canEditStops: Bool { generated || proposal != nil || !stops.isEmpty }

    /// Starts a fresh plan from `start`, discarding the current one.
    func reset(start: GeoPoint?) {
        token += 1
        status = .idle
        self.start = start
        end = nil
        destination = nil
        destinationId = nil
        destinationName = nil
        routeType = .roundTrip
        stops = []
        keepOrder = false
        stopsAreSuggested = false
        mapMode = nil
        focusedStopKey = nil
        cancelReroute()
        proposal = nil
        failure = nil
        sportChosen = false
        shapeChosen = false
        stepsOpen = false
        clearGenerated()
    }

    /// The player's position became known: it starts the route unless a start was picked already.
    func locate(_ point: GeoPoint) {
        guard start == nil, isIdle, mapMode != .pickStart else { return }
        setStart(point)
    }

    /// "Route here": generates towards a curated POI; only it becomes a baseline stop.
    func setDestination(_ item: WorldCollectible) {
        guard isIdle else { return }
        destination = GeoPoint(lat: item.latitude, lon: item.longitude)
        destinationId = item.id
        destinationName = item.name
        end = nil
        mapMode = nil
        stops = []
        stopsAreSuggested = false
        restartGeneration()
    }

    /// Drops the chosen POI; the route aims at the map again.
    func clearDestination() {
        guard isIdle, destinationId != nil else { return }
        destination = nil
        destinationId = nil
        destinationName = nil
        end = nil
        stops = []
        stopsAreSuggested = false
        restartGeneration()
    }

    /// Wizard step 1. Changing the sport regenerates the routes.
    func chooseSport(_ sport: Sport) {
        guard isIdle else { return }
        let changed = !sportChosen || sport != self.sport
        self.sport = sport
        sportChosen = true
        if shapeChosen { stepsOpen = false }
        if changed { restartGeneration() }
    }

    /// Wizard step 2. An A→B route ends at the aim unless the player picks another end later.
    func chooseShape(_ type: RouteType) {
        guard isIdle else { return }
        let changed = !shapeChosen || type != routeType
        routeType = type
        shapeChosen = true
        stepsOpen = false
        mapMode = nil
        if changed, !suggestReplacesOwnStops { end = nil }
        if changed { restartGeneration() }
    }

    /// Reopens the wizard steps so the player can change sport or shape.
    func reopenSteps() {
        guard isIdle else { return }
        stepsOpen = true
        mapMode = nil
    }

    /// Asks the view to generate towards the current aim, e.g. after a retry.
    func requestGeneration() {
        guard canGenerate, isIdle else { return }
        generateRequest += 1
    }

    /// Only the explicitly selected curated destination becomes a baseline stop.
    private func adopt(_ suggestion: RouteProposal) {
        let byId = Dictionary((catalog?.collectibles ?? []).map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        stops = suggestion.includedTargetIds
            .filter { $0 == destinationId }
            .compactMap { byId[$0] }
            .map(PlannerStop.collectible)
        keepOrder = false
        stopsAreSuggested = true
        focusedStopKey = nil
        failure = nil
        generated = true
        proposal = suggestion
    }

    /// Drops the generated route; suggested stops go with it, the player's own stops stay.
    private func clearGenerated() {
        generated = false
        catalog = nil
        baselineProposal = nil
        explorationId = nil
        flowlineEnhancements = []
        selectedEnhancementIds = []
        enhancementMetrics = nil
        if stopsAreSuggested {
            stops = []
            stopsAreSuggested = false
            focusedStopKey = nil
        }
    }

    /// A new sport, shape or endpoint: generates again, but never replaces the player's own stops; those
    /// are routed again instead.
    private func restartGeneration() {
        cancelReroute()
        if suggestReplacesOwnStops {
            if proposal != nil || generated { rerouting {} }
            return
        }
        clearGenerated()
        proposal = nil
        failure = nil
        requestGeneration()
    }


    /// Toggles what the next map tap does.
    func toggleMapMode(_ mode: MapMode) {
        guard isIdle else { return }
        mapMode = mapMode == mode ? nil : mode
        failure = nil
    }

    func setStart(_ point: GeoPoint) {
        guard isIdle else { return }
        start = point
        if mapMode == .pickStart { mapMode = nil }
        endpointChanged()
    }

    private func setEnd(_ point: GeoPoint) {
        guard isIdle else { return }
        end = point
        destination = nil
        destinationId = nil
        destinationName = nil
        mapMode = nil
        endpointChanged()
    }

    /// A new start or end reroutes a route's stops; a route without stops is generated again.
    private func endpointChanged() {
        if !stops.isEmpty, generated || proposal != nil {
            rerouting {}
        } else {
            restartGeneration()
        }
    }

    /// A map tap on empty ground: sets an explicitly picked endpoint or adds a waypoint.
    @discardableResult
    func mapTapped(_ point: GeoPoint) -> Bool {
        guard isIdle else { return false }
        switch mapMode {
        case .pickStart: setStart(point)
        case .pickEnd: setEnd(point)
        case nil:
            guard canEditStops else { return false }
            toggle(.waypoint(point))
        }
        return true
    }

    /// Adds or removes a stop. The player's route has no stop limits.
    func toggle(_ stop: PlannerStop) {
        guard isIdle else { return }
        if contains(stop) {
            remove(stop)
            return
        }
        rerouting {
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

    /// Generates one route towards the aimed target: round trips ride there and back, A→B routes end at
    /// the picked end, else at the aim. Only a selected curated destination becomes a baseline stop.
    func generate(toward aim: GeoPoint) async {
        guard isIdle else { return }
        cancelReroute()
        guard let start else { return fail(.missingStart) }
        let target = destination ?? (routeType == .pointToPoint ? end ?? aim : aim)
        if routeType == .pointToPoint { end = target }
        let request = SuggestRequest(target: target, sport: sport.rawValue, start: start, destinationId: destinationId,
                                     routeType: routeType.rawValue)
        clearGenerated()
        proposal = nil
        plannedRoute = nil
        await run(.suggesting, unroutable: .noSuggestion) { [self] in
            let result: GeneratedExploration = try await api.post("/api/explorations/generate", body: request)
            guard !result.proposals.isEmpty else {
                failure = .noSuggestion
                return
            }
            catalog = result.catalog
            explorationId = result.explorationId
            flowlineEnhancements = result.flowlineEnhancements ?? []
            baselineProposal = result.proposals[0]
            adopt(result.proposals[0])
        }
    }

    /// Applies or removes optional cycling Flowlines while retaining the generated baseline for comparison.
    func setFlowlineEnhancement(_ id: String, enabled: Bool) async {
        guard isIdle, generated, stopsAreSuggested, let explorationId, let baselineProposal,
              flowlineEnhancements.contains(where: { $0.id == id }) else { return }
        let previous = selectedEnhancementIds
        if enabled { selectedEnhancementIds.insert(id) } else { selectedEnhancementIds.remove(id) }
        let selected = selectedEnhancementIds.sorted()
        await run(.routing) { [self] in
            let result: FlowlineEnhancementResponse = try await api.post(
                "/api/explorations/\(explorationId)/enhance",
                body: FlowlineEnhancementRequest(proposalId: baselineProposal.id, flowlineIds: selected)
            )
            proposal = result.proposal
            enhancementMetrics = selected.isEmpty ? nil : result.metrics
        }
        if failure != nil { selectedEnhancementIds = previous }
    }

    /// "Save Exploration": persists the routed plan as a planned QuestInstance with its PlannedRoute and
    /// starts a fresh plan. Starting the ride is a separate action in the saved routes list.
    @discardableResult
    func save() async -> Bool {
        guard isIdle, let proposal else { return false }
        var saved = false
        await run(.saving) { [self] in
            let _: SavedExploration = try await api.post("/api/explorations/save", body: SaveRequest(proposalId: proposal.id))
            reset(start: start)
            saved = true
        }
        return saved
    }

    /// Shows a saved route while nothing is being planned.
    func showPlannedRoute(_ route: PlannedRoute?) {
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
        selectedEnhancementIds = []
        enhancementMetrics = nil
    }

    /// An edit that keeps a calculated route current: after a short pause without further edits, the
    /// remaining stops are routed again, so several quick moves trigger only one request.
    private func rerouting(_ change: () -> Void) {
        guard isIdle else { return }
        let wasRouted = proposal != nil || reroute != nil || generated
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
            if current == token { status = .idle }
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
