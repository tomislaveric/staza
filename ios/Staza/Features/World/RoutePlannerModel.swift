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
/// towards the aim or a chosen POI. Added stops bend that baseline locally (`/reroute`); removing them
/// all restores it without a request. Cycling routes also offer a few nearby Flowlines as optional
/// enhancements, and every route lists nearby places to add. "Save Exploration" persists the route as a
/// planned Exploration; it never starts it.
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
        case missingStart, missingEnd, noStops, noRoute, noSuggestion, noReachableTargets
        case server(String?)
    }
    /// How a stop edit is routed, mirroring the web planner's `routeEdit`.
    enum RouteEdit: Equatable {
        /// Connects exactly the stops from scratch (`/plan`).
        case plan
        /// Only the baseline's own stops remain: the generated route comes back without a request.
        case baseline
        /// Detours the baseline to the added stops (`/reroute`).
        case reroute(RerouteRequest)
    }

    /// The last routed state, restored when an edit cannot be routed.
    private struct RouteSnapshot {
        let stops: [PlannerStop]
        let proposal: RouteProposal
        let stopsAreSuggested: Bool
        let selectedEnhancementIds: Set<String>
        let enhancementMetrics: FlowlineEnhancementMetrics?
        let keepOrder: Bool
        let nearbyCollectibles: [NearbyCollectible]
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
    /// The stop, nearby place or optional Flowline (`flowline:<id>`) the player tapped in the planner or
    /// on the map; the map highlights it and its planner row gets a border.
    private(set) var focusedKey: String?
    /// Bumped on every planner row tap so re-tapping the focused item centers it again.
    private(set) var focusRequest = 0
    /// The route for the current stops; every edit clears it.
    private(set) var proposal: RouteProposal?
    private(set) var baselineProposal: RouteProposal?
    private(set) var explorationId: String?
    private(set) var flowlineEnhancements: [FlowlineEnhancementOption] = []
    private(set) var selectedEnhancementIds: Set<String> = []
    private(set) var enhancementMetrics: FlowlineEnhancementMetrics?
    /// POIs near the current route the player may add as stops.
    private(set) var nearbyCollectibles: [NearbyCollectible] = []
    /// The baseline's nearby places, shown again when the baseline is restored.
    private(set) var baselineNearbyCollectibles: [NearbyCollectible] = []
    private(set) var failure: Failure?
    private(set) var plannedRoute: PlannedRoute?

    private let api: APIClient
    private var token = 0
    /// How long reordering or removing stops may pause before the shown route is recalculated.
    private let rerouteDelay: Duration
    private var reroute: Task<Void, Never>?
    private var lastRoute: RouteSnapshot?

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

    /// Nearby places that are not stops yet; an added one moves to the stop list.
    var nearbyChoices: [NearbyCollectible] {
        generated ? nearbyCollectibles.filter { !contains(.collectible($0.collectible)) } : []
    }

    /// Flowlines the route already rides, except selected optional ones listed with the enhancements.
    var riddenFlowlines: [TraversedFlowline] {
        guard generated else { return [] }
        return (proposal?.traversedFlowlines ?? []).filter { !selectedEnhancementIds.contains($0.id) }
    }

    static func flowlineKey(_ id: String) -> String { "flowline:\(id)" }

    var focusedStop: PlannerStop? { stops.first { $0.key == focusedKey } }

    /// The focused stop or nearby place, if it is a POI.
    var focusedCollectibleId: String? {
        if case .collectible(let item)? = focusedStop { return item.id }
        return nearbyCollectibles.first { $0.id == focusedKey }?.id
    }

    /// The focused optional Flowline.
    var focusedFlowlineId: String? {
        flowlineEnhancements.first { Self.flowlineKey($0.id) == focusedKey }?.id
    }

    /// Where the focused item is, for centering the map.
    var focusedPoints: [GeoPoint] {
        if let stop = focusedStop { return stop.points }
        if let item = nearbyCollectibles.first(where: { $0.id == focusedKey })?.collectible {
            return [GeoPoint(lat: item.latitude, lon: item.longitude)]
        }
        if let flowline = flowlineEnhancements.first(where: { Self.flowlineKey($0.id) == focusedKey })?.flowline {
            return flowline.coordinates.map { GeoPoint(lat: $0.latitude, lon: $0.longitude) }
        }
        return []
    }

    /// Highlights a stop on the map and asks the map to center it.
    func focus(_ stop: PlannerStop) {
        guard contains(stop) else { return }
        focus(key: stop.key)
    }

    /// Highlights a nearby place on the map and asks the map to center it.
    func focus(nearby item: NearbyCollectible) {
        guard nearbyCollectibles.contains(where: { $0.id == item.id }) else { return }
        focus(key: item.id)
    }

    /// Highlights an optional Flowline on the map and asks the map to center it.
    func focus(flowline id: String) {
        guard flowlineEnhancements.contains(where: { $0.id == id }) else { return }
        focus(key: Self.flowlineKey(id))
    }

    /// A POI or Flowline tapped on the map highlights its planner row; the map is already there.
    func mapSelected(collectibleId id: String) {
        let planned = stops.contains { $0.key == id } || nearbyCollectibles.contains { $0.id == id }
        focusedKey = planned ? id : nil
    }

    func mapSelected(flowlineId id: String) {
        focusedKey = flowlineEnhancements.contains { $0.id == id } ? Self.flowlineKey(id) : nil
    }

    private func focus(key: String) {
        focusedKey = key
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
        focusedKey = nil
        cancelReroute()
        lastRoute = nil
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

    /// A generated route's stops: only the explicitly selected curated destination.
    private func suggestedStops(_ suggestion: RouteProposal) -> [PlannerStop] {
        let byId = Dictionary((catalog?.collectibles ?? []).map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return suggestion.includedTargetIds
            .filter { $0 == destinationId }
            .compactMap { byId[$0] }
            .map(PlannerStop.collectible)
    }

    private func adopt(_ suggestion: RouteProposal) {
        stops = suggestedStops(suggestion)
        keepOrder = false
        stopsAreSuggested = true
        focusedKey = nil
        failure = nil
        generated = true
        proposal = suggestion
    }

    /// How the current stops are routed: removing every added stop restores the baseline, adding stops while
    /// the suggested ones stay detours along the baseline, anything else (a reordered list, a removed
    /// destination) is planned from scratch.
    var routeEdit: RouteEdit {
        guard generated, let baselineProposal, explorationId != nil else { return .plan }
        let suggested = Set(suggestedStops(baselineProposal).map(\.key))
        let keys = stops.map(\.key)
        guard suggested.isSubset(of: keys) else { return .plan }
        if keys.count == suggested.count { return .baseline }
        if keepOrder { return .plan }
        var targetIds: [String] = [], waypoints: [GeoPoint] = []
        for stop in stops {
            switch stop {
            case .collectible(let item): targetIds.append(item.id)
            case .waypoint(let point): waypoints.append(point)
            }
        }
        return .reroute(RerouteRequest(proposalId: baselineProposal.id, targetIds: targetIds, waypoints: waypoints))
    }

    /// Removing every added stop brings back the generated route, its nearby places and optional Flowlines.
    private func restoreBaseline() {
        guard let baselineProposal else { return }
        cancelReroute()
        lastRoute = nil
        proposal = baselineProposal
        stops = suggestedStops(baselineProposal)
        stopsAreSuggested = true
        keepOrder = false
        selectedEnhancementIds = []
        enhancementMetrics = nil
        nearbyCollectibles = baselineNearbyCollectibles
        failure = nil
    }

    /// A new start, end, sport or shape: the generated baseline no longer fits, so the player's stops are
    /// planned from scratch and nothing restores the old baseline.
    private func dropBaseline() {
        baselineProposal = nil
        baselineNearbyCollectibles = []
        flowlineEnhancements = []
        stopsAreSuggested = false
        lastRoute = nil
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
        nearbyCollectibles = []
        baselineNearbyCollectibles = []
        lastRoute = nil
        if stopsAreSuggested {
            stops = []
            stopsAreSuggested = false
        }
        if focusedStop == nil { focusedKey = nil }
    }

    /// A new sport, shape or endpoint: generates again, but never replaces the player's own stops; those
    /// are routed again instead.
    private func restartGeneration() {
        cancelReroute()
        if suggestReplacesOwnStops {
            if proposal != nil || generated {
                dropBaseline()
                rerouting {}
            }
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
            dropBaseline()
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
            if focusedKey == stop.key { focusedKey = nil }
        }
    }

    func move(from source: IndexSet, to destination: Int) {
        rerouting {
            stops.move(fromOffsets: source, toOffset: destination)
            keepOrder = true
            stopsAreSuggested = false
        }
    }

    /// Connects the stops into one route; Staza's stop order is adopted unless the player set one.
    func route() async {
        cancelReroute()
        await performRoute()
    }

    private func performRoute() async {
        guard isIdle else { return }
        let edit = routeEdit
        if edit == .baseline { return restoreBaseline() }
        guard let start else { return fail(.missingStart) }
        guard routeType == .roundTrip || end != nil else { return fail(.missingEnd) }
        guard !stops.isEmpty, let area = Self.area(start: start, end: routeType == .pointToPoint ? end : nil, stops: stops) else { return fail(.noStops) }
        let request = PlanRequest(area: area, sport: sport.rawValue, start: start, routeType: routeType.rawValue,
                                  end: routeType == .pointToPoint ? end : nil, keepOrder: keepOrder, stops: stops)
        let succeeded = await run(.routing) { [self] in
            var routed: (proposal: RouteProposal, nearby: [NearbyCollectible]?)?
            if case .reroute(let body) = edit, let explorationId {
                do {
                    let result: ReroutedExploration = try await api.post("/api/explorations/\(explorationId)/reroute", body: body)
                    routed = (result.proposal, result.nearbyCollectibles)
                } catch is CancellationError {
                    throw CancellationError()
                } catch {
                    // An expired exploration or a stop the detour cannot reach still gets a fresh route.
                }
            }
            if routed == nil {
                let result: PlannedExploration = try await api.post("/api/explorations/plan", body: request)
                routed = (result.proposal, result.nearbyCollectibles)
            }
            guard let routed else { return }
            lastRoute = nil
            proposal = routed.proposal
            nearbyCollectibles = routed.nearby ?? nearbyCollectibles
            if let order = routed.proposal.stopOrder, !keepOrder { stops = Self.ordered(stops, by: order) }
        }
        // Keep the last working route: a stop that cannot be routed must not wipe it.
        if !succeeded, let lastRoute { restore(lastRoute) }
    }

    private func restore(_ snapshot: RouteSnapshot) {
        stops = snapshot.stops
        proposal = snapshot.proposal
        stopsAreSuggested = snapshot.stopsAreSuggested
        selectedEnhancementIds = snapshot.selectedEnhancementIds
        enhancementMetrics = snapshot.enhancementMetrics
        keepOrder = snapshot.keepOrder
        nearbyCollectibles = snapshot.nearbyCollectibles
        if focusedStop == nil, focusedCollectibleId == nil, focusedFlowlineId == nil { focusedKey = nil }
        lastRoute = nil
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
            nearbyCollectibles = result.nearbyCollectibles ?? []
            baselineNearbyCollectibles = nearbyCollectibles
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
            nearbyCollectibles = result.nearbyCollectibles ?? nearbyCollectibles
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
        if let proposal {
            lastRoute = RouteSnapshot(stops: stops, proposal: proposal, stopsAreSuggested: stopsAreSuggested,
                                      selectedEnhancementIds: selectedEnhancementIds, enhancementMetrics: enhancementMetrics,
                                      keepOrder: keepOrder, nearbyCollectibles: nearbyCollectibles)
        }
        edit(change)
        cancelReroute()
        if wasRouted, routeEdit == .baseline { return restoreBaseline() }
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

    /// `unroutable` is the failure shown when the server finds no route (422). Returns `false` when this
    /// request failed and is still the current one.
    @discardableResult
    private func run(_ running: Status, unroutable: Failure = .noRoute, _ work: () async throws -> Void) async -> Bool {
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
            guard current == token else { return true }
            status = .idle
            failure = Self.failure(for: error, unroutable: unroutable)
            if Self.isExpired(error) { proposal = nil }
            return false
        }
        return true
    }

    private static func failure(for error: Error, unroutable: Failure) -> Failure {
        guard case APIError.server(let status, let message, let code) = error else { return .server(nil) }
        if code == "no_reachable_targets" { return .noReachableTargets }
        return status == 422 ? unroutable : .server(message)
    }

    private static func isExpired(_ error: Error) -> Bool {
        if case APIError.server(_, _, let code) = error { return code == "proposal_expired" || code == "exploration_expired" }
        return false
    }
}
