import Foundation
import Observation

@MainActor
@Observable
final class SkillAtlasModel {
    private(set) var atlas: SkillAtlasView_?
    private(set) var isLoading = false
    private(set) var failed = false
    private(set) var unlockingNodeId: String?
    private(set) var unlockError: String?
    var selectedSport: String?

    private let api: APIClient

    init(api: APIClient) { self.api = api }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            atlas = try await api.get("/api/skill-tree")
            failed = false
        } catch is CancellationError {
            return
        } catch {
            failed = true
        }
    }

    var sports: [String] {
        var seen: [String] = []
        for node in atlas?.nodes ?? [] where !seen.contains(node.sport) { seen.append(node.sport) }
        return seen
    }

    var activeSport: String? { selectedSport.flatMap { sports.contains($0) ? $0 : nil } ?? sports.first }

    /// Nodes of the active sport in lane-tree reading order (row, then column).
    var visibleNodes: [SkillAtlasView_.Node] { laneLayout?.nodes.map(\.node) ?? [] }

    /// Lane layout of the active sport.
    var laneLayout: SkillAtlasLaneLayout? {
        guard let atlas, let activeSport else { return nil }
        return SkillAtlasLaneLayout(nodes: atlas.nodes, sport: activeSport)
    }

    /// Unlockable nodes across all sports, cheapest first, then in sport order.
    var nextUpNodes: [SkillAtlasView_.Node] {
        let order = sports
        return (atlas?.nodes ?? [])
            .filter { $0.state == .unlockable }
            .enumerated()
            .sorted { ($0.element.cost, order.firstIndex(of: $0.element.sport) ?? 0, $0.offset)
                < ($1.element.cost, order.firstIndex(of: $1.element.sport) ?? 0, $1.offset) }
            .map(\.element)
    }

    /// Node whose detail sheet is open.
    private(set) var selectedNodeId: String?

    var selectedNode: SkillAtlasView_.Node? { selectedNodeId.flatMap(node(withId:)) }

    func node(withId id: String) -> SkillAtlasView_.Node? { atlas?.nodes.first { $0.id == id } }

    /// Opens a node's details and switches to its sport so the tree shows it.
    func select(_ id: String) {
        guard let node = node(withId: id) else { return }
        selectedSport = node.sport
        selectedNodeId = id
    }

    func clearSelection() { selectedNodeId = nil }

    func name(ofNode id: String) -> String { atlas?.nodes.first { $0.id == id }?.name ?? id }

    /// Returns whether the node was unlocked.
    @discardableResult
    func unlock(_ node: SkillAtlasView_.Node) async -> Bool {
        guard unlockingNodeId == nil else { return false }
        unlockingNodeId = node.id
        unlockError = nil
        defer { unlockingNodeId = nil }
        do {
            atlas = try await api.post("/api/skill-tree/unlock", body: SkillUnlockRequest(nodeId: node.id))
            return true
        } catch is CancellationError {
            return false
        } catch let APIError.server(_, message, _) {
            unlockError = message
            await load()
        } catch {
            unlockError = error.localizedDescription
        }
        return false
    }
}
