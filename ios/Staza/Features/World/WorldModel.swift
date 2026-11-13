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
    private(set) var activeInstanceIds: [String] = []
    var selection: WorldSelection?

    private let api: APIClient
    private var viewportTask: Task<Void, Never>?

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
        do {
            let viewport: WorldViewport = try await api.get("/api/world", query: [URLQueryItem(name: "bbox", value: bounds.queryValue)])
            collectibles = viewport.collectibles ?? []
            flowlines = viewport.fartleks ?? []
            truncated = viewport.truncated ?? false
            viewportFailed = false
        } catch is CancellationError {
            return
        } catch {
            viewportFailed = true
        }
    }

    func select(_ kind: WorldSelectionKind, id: String) {
        switch kind {
        case .collectible:
            if let item = (questTargets.collectibles + collectibles).first(where: { $0.id == id }) { selection = .collectible(item) }
        case .flowline:
            if let item = (questTargets.flowlines + flowlines).first(where: { $0.id == id }) { selection = .flowline(item) }
        }
    }

    func isQuestTarget(_ selection: WorldSelection) -> Bool {
        switch selection {
        case .collectible(let item): questTargets.collectibles.contains { $0.id == item.id }
        case .flowline(let item): questTargets.flowlines.contains { $0.id == item.id }
        }
    }

    func loadQuestTargets() async {
        do {
            let quests: QuestInstancesResponse = try await api.get("/api/quest-instances")
            activeInstanceIds = quests.instances.filter(\.isActive).map(\.id)
            let ids = Self.targetIds(in: quests.instances.filter(\.isActive))
            guard !ids.collectibles.isEmpty || !ids.flowlines.isEmpty else {
                questTargets = .empty
                return
            }
            let query = ids.collectibles.map { URLQueryItem(name: "collectibleId", value: $0) }
                + ids.flowlines.map { URLQueryItem(name: "flowlineId", value: $0) }
            questTargets = try await api.get("/api/world/quest-targets", query: query)
        } catch is CancellationError {
            return
        } catch {
            questTargets = .empty
        }
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
