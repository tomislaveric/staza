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

    /// Nodes of the active sport in server layout order (row, then column).
    var visibleNodes: [SkillAtlasView_.Node] {
        (atlas?.nodes ?? [])
            .filter { $0.sport == activeSport }
            .sorted { ($0.layout.row, $0.layout.col) < ($1.layout.row, $1.layout.col) }
    }

    func name(ofNode id: String) -> String { atlas?.nodes.first { $0.id == id }?.name ?? id }

    func unlock(_ node: SkillAtlasView_.Node) async {
        guard unlockingNodeId == nil else { return }
        unlockingNodeId = node.id
        unlockError = nil
        defer { unlockingNodeId = nil }
        do {
            atlas = try await api.post("/api/skill-tree/unlock", body: SkillUnlockRequest(nodeId: node.id))
        } catch is CancellationError {
            return
        } catch let APIError.server(_, message, _) {
            unlockError = message
            await load()
        } catch {
            unlockError = error.localizedDescription
        }
    }
}
