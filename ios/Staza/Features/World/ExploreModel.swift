import CoreLocation
import Foundation
import Observation

@MainActor
@Observable
final class ExploreModel {
    enum Phase: Equatable { case idle, configure, generating, proposals, confirming }
    enum Failure: Equatable { case generate, reroute, confirm, noRoute }

    static let distancePresetsKm = [20, 40, 60, 100]

    private(set) var phase = Phase.idle
    private(set) var failure: Failure?
    private(set) var isRerouting = false
    private(set) var proposals: [RouteProposal] = []
    private(set) var catalog: [WorldCollectible] = []
    private(set) var selectedId: String?
    private(set) var plannedRoute: PlannedRoute?
    var distanceKm = 40
    var useUserLocation = false
    private(set) var area: ExploreArea?
    private(set) var userLocation: GeoPoint?

    private let api: APIClient
    private var explorationId: String?
    private var original: [String: RouteProposal] = [:]
    private var baseIds: [String: String] = [:]

    init(api: APIClient) { self.api = api }

    var selected: RouteProposal? { proposals.first { $0.id == selectedId } }

    /// The route to draw: the selected proposal while exploring, else the confirmed planned route.
    var displayedRoute: [CLLocationCoordinate2D] {
        selected?.geometry.clCoordinates ?? plannedRoute?.geometry.clCoordinates ?? []
    }

    var isActive: Bool { phase != .idle }

    var includedTargets: [WorldCollectible] {
        guard let selected else { return [] }
        let byId = Dictionary(catalog.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return selected.includedTargetIds.compactMap { byId[$0] }
    }

    var addableTargets: [WorldCollectible] {
        let included = Set(selected?.includedTargetIds ?? [])
        return catalog.filter { !included.contains($0.id) }
    }

    var isCustomized: Bool {
        guard let selected, let base = base(of: selected.id) else { return false }
        return Set(base.includedTargetIds) != Set(selected.includedTargetIds)
    }

    func begin(bounds: WorldBounds, userLocation: GeoPoint?) {
        area = ExploreArea(bounds: bounds)
        self.userLocation = userLocation
        useUserLocation = false
        discardProposals()
        plannedRoute = nil
        failure = nil
        phase = .configure
    }

    func cancel() {
        discardProposals()
        failure = nil
        phase = .idle
    }

    func changeRide() {
        discardProposals()
        failure = nil
        phase = .configure
    }

    func generate() async {
        guard let area, phase == .configure else { return }
        phase = .generating
        failure = nil
        let start = useUserLocation ? (userLocation ?? area.center) : area.center
        let request = GenerateRequest(
            area: .init(bbox: area.bounds.queryValue, center: area.center, zoom: 12),
            start: start,
            constraint: .init(value: Double(distanceKm * 1000))
        )
        do {
            let result: GeneratedExploration = try await api.post("/api/explorations/generate", body: request)
            guard phase == .generating else { return }
            guard !result.proposals.isEmpty else {
                failure = .noRoute
                phase = .configure
                return
            }
            explorationId = result.explorationId
            proposals = result.proposals
            original = Dictionary(result.proposals.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            catalog = result.catalog.collectibles
            selectedId = (result.proposals.first { $0.recommended == true } ?? result.proposals[0]).id
            phase = .proposals
        } catch is CancellationError {
            if phase == .generating { phase = .configure }
        } catch {
            guard phase == .generating else { return }
            failure = Self.isUnprocessable(error) ? .noRoute : .generate
            phase = .configure
        }
    }

    func select(_ id: String) {
        guard !isRerouting, proposals.contains(where: { $0.id == id }) else { return }
        selectedId = id
    }

    func remove(_ targetId: String) async {
        guard let selected, selected.includedTargetIds.count > 1 else { return }
        await reroute(selected.includedTargetIds.filter { $0 != targetId })
    }

    func add(_ targetId: String) async {
        guard let selected else { return }
        await reroute(selected.includedTargetIds + [targetId])
    }

    func reset() {
        guard let selected, let base = base(of: selected.id) else { return }
        replace(selected.id, with: base)
    }

    private func reroute(_ targetIds: [String]) async {
        guard let selected, let explorationId, !isRerouting else { return }
        isRerouting = true
        failure = nil
        defer { isRerouting = false }
        do {
            let response: RerouteResponse = try await api.post(
                "/api/explorations/\(explorationId)/reroute",
                body: RerouteRequest(proposalId: selected.id, targetIds: targetIds)
            )
            baseIds[response.proposal.id] = baseIds[selected.id] ?? selected.id
            replace(selected.id, with: response.proposal)
        } catch is CancellationError {
            return
        } catch {
            failure = .reroute
        }
    }

    func confirm() async {
        guard let selected, phase == .proposals, !isRerouting else { return }
        phase = .confirming
        failure = nil
        do {
            let response: ConfirmedExploration = try await api.post("/api/explorations/confirm", body: ConfirmRequest(proposalId: selected.id))
            plannedRoute = response.plannedRoute
            discardProposals()
            phase = .idle
        } catch {
            failure = .confirm
            phase = .proposals
        }
    }

    /// Shows the planned route of the first active exploration that has one.
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

    private func base(of id: String) -> RouteProposal? { original[baseIds[id] ?? id] }

    private func replace(_ id: String, with proposal: RouteProposal) {
        guard let index = proposals.firstIndex(where: { $0.id == id }) else { return }
        proposals[index] = proposal
        if selectedId == id { selectedId = proposal.id }
    }

    private func discardProposals() {
        proposals = []
        catalog = []
        selectedId = nil
        explorationId = nil
        original = [:]
        baseIds = [:]
        isRerouting = false
    }

    private static func isUnprocessable(_ error: Error) -> Bool {
        if case APIError.server(let status, _, _) = error { return status == 422 }
        return false
    }
}
