import Foundation
import Observation

@MainActor
@Observable
final class WorldModel {
    private(set) var basemap: Basemap?
    private(set) var basemapFailed = false
    private(set) var collectibles: [WorldCollectible] = []
    private(set) var flowlines: [WorldFlowline] = []
    private(set) var questTargets = QuestTargets.empty
    private(set) var truncated = false
    private(set) var viewportFailed = false
    private(set) var bounds: WorldBounds?
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
    var visibleFlowlines: [WorldFlowline] { WorldFilters.flowlines(flowlines, selected: selectedFilters) }

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

    func select(_ kind: WorldSelectionKind, id: String) {
        switch kind {
        case .collectible:
            if let item = (mapQuestTargets.collectibles + questTargets.collectibles + collectibles).first(where: { $0.id == id }) { selection = .collectible(item) }
        case .flowline:
            if let item = (mapQuestTargets.flowlines + questTargets.flowlines + flowlines).first(where: { $0.id == id }) { selection = .flowline(item) }
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
