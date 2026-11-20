import Foundation
import Observation

@MainActor
@Observable
final class WorldModel {
    private(set) var basemap: Basemap?
    private(set) var basemapFailed = false
    private(set) var collectibles: [WorldCollectible] = []
    private(set) var flowlines: [WorldFlowline] = []
    private(set) var areaStatus: AreaStatus?
    /// The Explore card: running, a result, or a failure. `nil` when dismissed.
    private(set) var exploreState: ExploreState?
    /// Newly revealed Flowlines not drawn yet while the reveal is staggered.
    private(set) var revealing: Set<String> = []
    private(set) var questTargets = QuestTargets.empty
    private(set) var truncated = false
    private(set) var viewportFailed = false
    private(set) var bounds: WorldBounds?
    /// The area `areaStatus` describes; Explore reveals exactly this area so the CTA and the outcome agree.
    private var areaBounds: WorldBounds?
    private(set) var stats: WorldStats?
    private(set) var instances: [QuestInstance] = []
    private(set) var capabilities = WorldCapabilities.empty
    private(set) var highlightedInstanceId: String?
    private(set) var highlightedTargets: QuestTargets?
    private(set) var pendingInstanceId: String?
    private(set) var plannedRoutes: [String: PlannedRoute] = [:]
    private(set) var instanceActionFailed = false
    var selectedFilters: Set<WorldFilter> = []
    var selection: WorldSelection?

    var activeInstanceIds: [String] { instances.filter(\.isActive).map(\.id) }

    var availableFilters: [WorldFilter] {
        WorldFilters.available(collectibles: collectibles, flowlines: flowlines, granted: capabilities.worldFilters)
    }

    /// Advanced filters the player has not unlocked yet, with the Skill Atlas node that grants each.
    var lockedFilters: [(filter: WorldFilter, nodeName: String)] {
        capabilities.lockedWorldFilters.compactMap { locked in
            guard let filter = WorldFilter(rawValue: locked.id), !capabilities.worldFilters.contains(locked.id) else { return nil }
            return (filter, locked.nodeName)
        }
    }

    var visibleCollectibles: [WorldCollectible] { WorldFilters.collectibles(collectibles, selected: selectedFilters) }
    var visibleFlowlines: [WorldFlowline] {
        WorldFilters.flowlines(flowlines, selected: selectedFilters).filter { !revealing.contains($0.id) }
    }

    var exploreAction: ExploreAction { ExploreAction(areaStatus) }
    var isExploring: Bool { exploreState == .exploring }

    /// Quest targets drawn on the map: the highlighted exploration's, else every active one's.
    var mapQuestTargets: QuestTargets { highlightedTargets ?? questTargets }

    private let api: APIClient
    private var viewportTask: Task<Void, Never>?
    private var viewportGeneration = 0

    init(api: APIClient) { self.api = api }

    func loadBasemap() async {
        guard basemap == nil else { return }
        do {
            basemap = try await api.get("/api/world/basemap")
            basemapFailed = false
        } catch is CancellationError {
            return
        } catch {
            basemapFailed = true
        }
    }

    /// Debounced so panning the map issues one request once the camera settles.
    func viewportChanged(_ bounds: WorldBounds) {
        self.bounds = bounds
        viewportTask?.cancel()
        viewportTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            await self?.loadViewport(bounds)
        }
    }

    func loadViewport(_ bounds: WorldBounds) async {
        viewportGeneration += 1
        let generation = viewportGeneration
        do {
            let viewport: WorldViewport = try await api.get("/api/world", query: [URLQueryItem(name: "bbox", value: bounds.queryValue)])
            // A newer viewport request started meanwhile; its response wins.
            guard generation == viewportGeneration else { return }
            collectibles = viewport.collectibles ?? []
            flowlines = viewport.fartleks ?? []
            areaStatus = viewport.areaStatus
            areaBounds = bounds
            truncated = viewport.truncated ?? false
            stats = viewport.stats
            viewportFailed = false
        } catch is CancellationError {
            return
        } catch {
            guard generation == viewportGeneration else { return }
            viewportFailed = true
        }
    }

    /// Explore this area: reveals the visible area's eligible Flowlines. Never plans a route.
    func exploreArea(reduceMotion: Bool = false) async {
        guard let bounds = areaBounds, !isExploring, exploreAction == .explore || exploreAction == .exploreNew else { return }
        exploreState = .exploring
        do {
            let result: ExploreResult = try await api.post("/api/world/explore", body: ExploreRequest(bbox: bounds.queryValue))
            if let status = areaStatus {
                areaStatus = AreaStatus(exploreAllowed: status.exploreAllowed, knownFlowlines: result.knownCount, availableFlowlines: result.availableCount)
            }
            exploreState = .result(result)
            await reveal(result.revealed, reduceMotion: reduceMotion)
        } catch is CancellationError {
            exploreState = nil
        } catch {
            exploreState = .failed(Self.message(error))
        }
    }

    func dismissExplore() { exploreState = nil }

    /// Adds newly revealed Flowlines and lets them appear one after another, at once with reduced motion.
    private func reveal(_ revealed: [WorldFlowline], reduceMotion: Bool) async {
        let known = Set(flowlines.map(\.id))
        let fresh = revealed.filter { !known.contains($0.id) }
        guard !fresh.isEmpty else { return }
        if !reduceMotion { revealing.formUnion(fresh.map(\.id)) }
        flowlines += fresh
        guard !reduceMotion else { return }
        for flowline in fresh {
            revealing.remove(flowline.id)
            try? await Task.sleep(for: .milliseconds(140))
        }
        revealing = []
    }

    private static func message(_ error: Error) -> String? {
        if case APIError.server(_, let message, _) = error { return message }
        return nil
    }

    func flowline(id: String) -> WorldFlowline? {
        (mapQuestTargets.flowlines + questTargets.flowlines + flowlines).first { $0.id == id }
    }

    func collectible(id: String) -> WorldCollectible? {
        (mapQuestTargets.collectibles + questTargets.collectibles + collectibles).first { $0.id == id }
    }

    func select(_ kind: WorldSelectionKind, id: String) {
        switch kind {
        case .collectible:
            if let item = collectible(id: id) { selection = .collectible(item) }
        case .flowline:
            if let item = flowline(id: id) { selection = .flowline(item) }
        }
    }

    func isQuestTarget(_ selection: WorldSelection) -> Bool {
        switch selection {
        case .collectible(let item): (questTargets.collectibles + mapQuestTargets.collectibles).contains { $0.id == item.id }
        case .flowline(let item): (questTargets.flowlines + mapQuestTargets.flowlines).contains { $0.id == item.id }
        }
    }

    func loadQuestTargets() async {
        do {
            let quests: QuestInstancesResponse = try await api.get("/api/quest-instances")
            instances = quests.instances
            if let highlightedInstanceId, !instances.contains(where: { $0.id == highlightedInstanceId }) { clearHighlight() }
            questTargets = try await targets(for: quests.instances.filter(\.isActive))
        } catch is CancellationError {
            return
        } catch {
            questTargets = .empty
        }
    }

    /// Planned routes of active explorations, used for their summaries and the map route.
    func loadPlannedRoutes() async {
        let ids = Array(activeInstanceIds.prefix(10))
        var loaded: [String: PlannedRoute] = [:]
        await withTaskGroup(of: (String, PlannedRoute?).self) { group in
            for id in ids {
                group.addTask { [api] in
                    (id, try? await api.get("/api/quest-instances/\(id)/planned-route", as: PlannedRoute.self))
                }
            }
            for await (id, route) in group { if let route { loaded[id] = route } }
        }
        plannedRoutes = loaded
    }

    /// The planned route of the highlighted exploration, else of the first active one that has one.
    var preferredPlannedRoute: PlannedRoute? {
        if let highlightedInstanceId { return plannedRoutes[highlightedInstanceId] }
        return activeInstanceIds.lazy.compactMap { self.plannedRoutes[$0] }.first
    }

    func loadCapabilities() async {
        guard let loaded: WorldCapabilities = try? await api.get("/api/player/capabilities") else { return }
        capabilities = loaded
        // Drop selections the player can no longer use.
        selectedFilters = selectedFilters.filter { !$0.isAdvanced || loaded.worldFilters.contains($0.rawValue) }
    }

    func toggle(_ filter: WorldFilter) {
        if selectedFilters.contains(filter) { selectedFilters.remove(filter) } else { selectedFilters.insert(filter) }
    }

    func clearFilters() { selectedFilters = [] }

    /// Shows only this exploration's targets on the map; selecting it again clears the highlight.
    func highlight(_ instanceId: String) async {
        guard highlightedInstanceId != instanceId else {
            clearHighlight()
            return
        }
        guard let instance = instances.first(where: { $0.id == instanceId }) else { return }
        highlightedInstanceId = instanceId
        let loaded = try? await targets(for: [instance])
        guard highlightedInstanceId == instanceId else { return }
        highlightedTargets = loaded ?? .empty
    }

    func clearHighlight() {
        highlightedInstanceId = nil
        highlightedTargets = nil
    }

    /// Cancels an active exploration. Returns whether it succeeded.
    @discardableResult
    func cancel(_ instanceId: String) async -> Bool {
        await mutate(instanceId) { try await self.api.delete("/api/quest-instances/\(instanceId)") }
    }

    /// Restarts a failed exploration. Returns whether it succeeded.
    @discardableResult
    func retry(_ instanceId: String) async -> Bool {
        await mutate(instanceId) {
            let _: EmptyResponse = try await self.api.post("/api/quest-instances/\(instanceId)/retry")
        }
    }

    private func mutate(_ instanceId: String, _ action: () async throws -> Void) async -> Bool {
        guard pendingInstanceId == nil else { return false }
        pendingInstanceId = instanceId
        instanceActionFailed = false
        defer { pendingInstanceId = nil }
        do {
            try await action()
        } catch {
            instanceActionFailed = true
            return false
        }
        if highlightedInstanceId == instanceId { clearHighlight() }
        await loadQuestTargets()
        return true
    }

    private func targets(for quests: [QuestInstance]) async throws -> QuestTargets {
        let ids = Self.targetIds(in: quests)
        guard !ids.collectibles.isEmpty || !ids.flowlines.isEmpty else { return .empty }
        let query = ids.collectibles.map { URLQueryItem(name: "collectibleId", value: $0) }
            + ids.flowlines.map { URLQueryItem(name: "flowlineId", value: $0) }
        return try await api.get("/api/world/quest-targets", query: query)
    }

    /// Quest target ids, capped at the endpoint's limit of 100 and split by objective kind.
    static func targetIds(in quests: [QuestInstance]) -> (collectibles: [String], flowlines: [String]) {
        var collectibles: [String] = []
        var flowlines: [String] = []
        for objective in quests.flatMap(\.objectives) {
            guard let spec = objective.objective else { continue }
            let ids = (spec.targets ?? []).map(\.id)
            if spec.type == "flowline_rule" { flowlines += ids } else { collectibles += ids }
        }
        func unique(_ ids: [String]) -> [String] {
            var seen = Set<String>()
            return ids.filter { seen.insert($0).inserted }
        }
        let uniqueCollectibles = unique(collectibles)
        let uniqueFlowlines = unique(flowlines)
        let collectibleCap = max(100 - uniqueFlowlines.count, 0)
        return (Array(uniqueCollectibles.prefix(collectibleCap)), Array(uniqueFlowlines.prefix(100)))
    }
}

enum ExploreState: Equatable, Sendable {
    case exploring
    case result(ExploreResult)
    /// A failure, with the server's message when it sent one.
    case failed(String?)
}
