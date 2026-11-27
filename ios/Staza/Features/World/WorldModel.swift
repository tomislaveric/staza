import Foundation
import Observation

/// World data behind Explore: the basemap, curated POIs and saved Exploration routes in the viewport,
/// and the player's saved Explorations.
@MainActor
@Observable
final class WorldModel {
    private(set) var basemap: Basemap?
    private(set) var basemapFailed = false
    /// Curated POIs in the viewport; a tapped one can become the route's destination or a stop.
    private(set) var collectibles: [WorldCollectible] = []
    /// Saved Exploration routes in the viewport, drawn dotted whatever their status.
    private(set) var explorationRoutes: [ExplorationRoute] = []
    private(set) var viewportFailed = false
    private(set) var bounds: WorldBounds?
    /// The map area above the sheet, reported by the map; generation aims at its center.
    var visibleArea: WorldBounds?
    private(set) var instances: [QuestInstance] = []
    private(set) var plannedRoutes: [String: PlannedRoute] = [:]
    /// The saved Exploration whose route is shown on the map.
    private(set) var highlightedInstanceId: String?
    private(set) var pendingInstanceId: String?
    private(set) var instanceActionFailed = false
    /// The tapped POI shown in the sheet.
    var selection: WorldCollectible?

    var highlightedRoute: PlannedRoute? { highlightedInstanceId.flatMap { plannedRoutes[$0] } }

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
            collectibles = (viewport.collectibles ?? []).filter { $0.visibility != "hidden" }
            explorationRoutes = viewport.explorationRoutes ?? []
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

    func collectible(id: String) -> WorldCollectible? { collectibles.first { $0.id == id } }

    /// Saved Explorations and their planned routes, used for the list's metrics and the shown route.
    func loadExplorations() async {
        guard let quests: QuestInstancesResponse = try? await api.get("/api/quest-instances") else { return }
        instances = quests.instances
        if let highlightedInstanceId, !instances.contains(where: { $0.id == highlightedInstanceId }) { self.highlightedInstanceId = nil }
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

    /// Shows this Exploration's route on the map; selecting it again hides it.
    func highlight(_ instanceId: String) {
        highlightedInstanceId = highlightedInstanceId == instanceId ? nil : instanceId
    }

    func clearHighlight() { highlightedInstanceId = nil }

    /// Deletes a saved Exploration of any status; its route leaves the map. Returns whether it succeeded.
    @discardableResult
    func delete(_ instanceId: String) async -> Bool {
        await mutate(instanceId) {
            try await self.api.delete("/api/quest-instances/\(instanceId)")
            self.explorationRoutes.removeAll { $0.id == instanceId }
            self.plannedRoutes[instanceId] = nil
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
        await loadExplorations()
        return true
    }
}
