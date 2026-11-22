import Foundation
import Observation

@MainActor
@Observable
final class WorldModel {
    private(set) var basemap: Basemap?
    private(set) var basemapFailed = false
    /// The player's collected collectibles plus the open Explore session's uncollected ones.
    private(set) var collectibles: [WorldCollectible] = []
    /// Completed Flowlines in the viewport plus the open Explore session's opportunities.
    private(set) var flowlines: [WorldFlowline] = []
    /// Saved Exploration routes in the viewport, drawn whatever their status.
    private(set) var explorationRoutes: [ExplorationRoute] = []
    /// The open Explore session's opportunity Flowlines: what the opportunities sheet lists.
    private(set) var sessionFlowlines: [WorldFlowline] = []
    /// The open Explore session's uncollected collectibles.
    private(set) var sessionCollectibles: [WorldCollectible] = []
    /// The explored area while an Explore session is open; generated routes stay inside it.
    private(set) var sessionBounds: WorldBounds?
    /// The explored frame, drawn on the map while a wide viewport was clamped to it.
    private(set) var exploreFrame: WorldBounds?
    /// The Explore card: running, a result, or a failure. `nil` when dismissed.
    private(set) var exploreState: ExploreState?
    /// Opportunity Flowlines not drawn yet while their appearance is staggered.
    private(set) var revealing: Set<String> = []
    private(set) var questTargets = QuestTargets.empty
    private(set) var truncated = false
    private(set) var viewportFailed = false
    private(set) var bounds: WorldBounds?
    /// The last loaded viewport; Explore explores it, clamped by the server to a maximum frame.
    private var areaBounds: WorldBounds?
    /// The persistent world of the viewport: collected collectibles and completed Flowlines.
    private var collectedCollectibles: [WorldCollectible] = []
    private var completedFlowlines: [WorldFlowline] = []
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

    var isExploring: Bool { exploreState == .exploring }

    var hasExploreSession: Bool { sessionBounds != nil }

    /// Quest targets drawn on the map: only the highlighted exploration's. Unvisited targets are not
    /// part of the persistent world.
    var mapQuestTargets: QuestTargets { highlightedTargets ?? .empty }

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
            collectedCollectibles = viewport.collectibles ?? []
            completedFlowlines = viewport.fartleks ?? []
            explorationRoutes = viewport.explorationRoutes ?? []
            mergeWorld()
            areaBounds = bounds
            truncated = viewport.truncated ?? false
            viewportFailed = false
        } catch is CancellationError {
            return
        } catch {
            guard generation == viewportGeneration else { return }
            viewportFailed = true
        }
    }

    /// Reloads the current viewport, e.g. after an Exploration was saved or deleted.
    func reloadViewport() async {
        guard let bounds else { return }
        await loadViewport(bounds)
    }

    /// Explore this area: opens a session showing the area's opportunities. Persists nothing and
    /// replaces any previous session.
    func exploreArea(reduceMotion: Bool = false) async {
        guard let bounds = areaBounds, !isExploring else { return }
        endExploreSession()
        exploreState = .exploring
        do {
            let result: ExploreResult = try await api.post("/api/world/explore", body: ExploreRequest(bbox: bounds.queryValue))
            let explored = result.area?.bounds
            sessionBounds = explored ?? bounds
            exploreFrame = result.area?.clamped == true ? explored : nil
            sessionFlowlines = result.flowlines.uniqued()
            sessionCollectibles = result.collectibles
            exploreState = .result(result)
            await reveal(reduceMotion: reduceMotion)
        } catch is CancellationError {
            exploreState = nil
        } catch {
            exploreState = .failed(Self.message(error))
        }
    }

    /// Hides the Explore card; the session's opportunities stay, e.g. while planning a route.
    func dismissExplore() { exploreState = nil }

    /// Ends the Explore session: its opportunities leave the map.
    func endExploreSession() {
        exploreState = nil
        sessionBounds = nil
        exploreFrame = nil
        sessionFlowlines = []
        sessionCollectibles = []
        revealing = []
        mergeWorld()
    }

    /// Opportunity Flowlines appear one after another, at once with reduced motion.
    private func reveal(reduceMotion: Bool) async {
        let shown = Set(flowlines.map(\.id))
        let fresh = sessionFlowlines.filter { !shown.contains($0.id) }
        if !reduceMotion { revealing.formUnion(fresh.map(\.id)) }
        mergeWorld()
        guard !reduceMotion, !fresh.isEmpty else { return }
        for flowline in fresh {
            guard hasExploreSession else { break }
            revealing.remove(flowline.id)
            try? await Task.sleep(for: .milliseconds(140))
        }
        revealing = []
    }

    private func mergeWorld() {
        let completed = Set(completedFlowlines.map(\.id))
        flowlines = completedFlowlines + sessionFlowlines.filter { !completed.contains($0.id) }
        let collected = Set(collectedCollectibles.map(\.id))
        collectibles = collectedCollectibles + sessionCollectibles.filter { !collected.contains($0.id) }
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

    /// Planned routes of saved explorations, used for their summaries and the selected exploration's route.
    func loadPlannedRoutes() async {
        let ids = Array(instances.map(\.id).prefix(20))
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

    /// The planned route of the highlighted exploration. Every saved route is drawn dotted anyway.
    var preferredPlannedRoute: PlannedRoute? {
        highlightedInstanceId.flatMap { plannedRoutes[$0] }
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

    /// Deletes a saved exploration of any status; its route leaves the map. Returns whether it succeeded.
    @discardableResult
    func delete(_ instanceId: String) async -> Bool {
        await mutate(instanceId) {
            try await self.api.delete("/api/quest-instances/\(instanceId)")
            self.explorationRoutes.removeAll { $0.id == instanceId }
            self.plannedRoutes[instanceId] = nil
        }
    }

    /// Starts a planned exploration. Returns whether it succeeded.
    @discardableResult
    func start(_ instanceId: String) async -> Bool {
        await mutate(instanceId) {
            let _: EmptyResponse = try await self.api.post("/api/quest-instances/\(instanceId)/start")
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

private extension Array where Element == WorldFlowline {
    func uniqued() -> [WorldFlowline] {
        var seen = Set<String>()
        return filter { seen.insert($0.id).inserted }
    }
}
