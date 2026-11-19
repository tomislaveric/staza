import Foundation

/// Portrait lane layout for one sport of the Skill Atlas. Pure and deterministic: the
/// grid has five columns, three branch lanes (0, 2, 4) with gutters (1, 3) between
/// them for cross-branch and cross-sport nodes. A node's row comes from its in-sport
/// prerequisite depth, and is pushed down only if its cell is already taken.
struct SkillAtlasLaneLayout: Equatable, Sendable {
    static let columnCount = 5
    static let laneColumns = [0, 2, 4]

    struct Placed: Equatable, Identifiable, Sendable {
        let node: SkillAtlasView_.Node
        let row: Int
        let col: Int
        /// Prerequisites that live in another sport's tree.
        let externalPrerequisites: [String]
        var id: String { node.id }
    }

    struct Edge: Equatable, Hashable, Sendable {
        enum Style: Sendable { case active, reachable, locked }
        let fromId: String
        let toId: String
        let style: Style
        /// The target is beyond the reachable frontier and should read faintly.
        let distant: Bool
    }

    struct Lane: Equatable, Sendable {
        let branch: String
        let col: Int
    }

    let nodes: [Placed]
    let edges: [Edge]
    let lanes: [Lane]
    let rowCount: Int

    /// Branch keys in lane order for a sport. EXPLORE and ENDURANCE are shared across sports.
    static func laneBranches(for sport: String) -> [String] {
        switch sport {
        case "running": ["speed", "adventure", "endurance"]
        case "hiking": ["summit", "adventure", "endurance"]
        default: ["rush", "adventure", "endurance"]
        }
    }

    init(nodes allNodes: [SkillAtlasView_.Node], sport: String) {
        let sportNodes = allNodes.filter { $0.sport == sport }
        let byId = Dictionary(uniqueKeysWithValues: allNodes.map { ($0.id, $0) })
        let inSport = Set(sportNodes.map(\.id))
        let branches = Self.laneBranches(for: sport)
        let laneCol = Dictionary(uniqueKeysWithValues: zip(branches, Self.laneColumns))
        lanes = zip(branches, Self.laneColumns).map { Lane(branch: $0, col: $1) }

        var depth: [String: Int] = [:]
        func depthOf(_ id: String, visiting: Set<String> = []) -> Int {
            if let known = depth[id] { return known }
            guard let node = byId[id], !visiting.contains(id) else { return 0 }
            let parents = node.prerequisites.filter(inSport.contains)
            let value = parents.isEmpty ? 0 : 1 + parents.map { depthOf($0, visiting: visiting.union([id])) }.max()!
            depth[id] = value
            return value
        }
        for node in sportNodes { _ = depthOf(node.id) }

        // Place shallow nodes first so parents always have a position; lane nodes win
        // over cross nodes at equal depth so lanes stay straight. Nodes reachable only
        // from other sports have no anchor in this tree and go to the bottom.
        let isLaneNode = { (node: SkillAtlasView_.Node) in node.branch == "root" || laneCol[node.branch] != nil }
        let isDetached = { (node: SkillAtlasView_.Node) in
            node.branch != "root" && !node.prerequisites.contains(where: inSport.contains)
        }
        let order = sportNodes.enumerated().sorted { lhs, rhs in
            let l = (isDetached(lhs.element) ? 1 : 0, depth[lhs.element.id] ?? 0, isLaneNode(lhs.element) ? 0 : 1, lhs.offset)
            let r = (isDetached(rhs.element) ? 1 : 0, depth[rhs.element.id] ?? 0, isLaneNode(rhs.element) ? 0 : 1, rhs.offset)
            return l < r
        }.map(\.element)

        var occupied = Set<[Int]>()
        var placed: [String: (row: Int, col: Int)] = [:]
        var result: [Placed] = []
        var detachedRow: Int?
        for node in order {
            let parents = node.prerequisites.filter { placed[$0] != nil }
            if isDetached(node), detachedRow == nil {
                detachedRow = (placed.values.map(\.row).max() ?? -1) + 1
            }
            let minRow = isDetached(node) ? detachedRow! : parents.map { placed[$0]!.row + 1 }.max() ?? 0
            let ideal: Int
            if node.branch == "root" {
                ideal = 2
            } else if let lane = laneCol[node.branch] {
                ideal = lane
            } else if parents.isEmpty {
                ideal = 2
            } else {
                let mean = Double(parents.map { placed[$0]!.col }.reduce(0, +)) / Double(parents.count)
                ideal = Int(mean.rounded())
            }
            let candidates = isLaneNode(node) ? [ideal] : [ideal, ideal - 1, ideal + 1]
                .filter { (0..<Self.columnCount).contains($0) }
            var row = max(minRow, depth[node.id] ?? 0)
            var col = ideal
            search: while true {
                for candidate in candidates where !occupied.contains([row, candidate]) {
                    col = candidate
                    break search
                }
                row += 1
            }
            occupied.insert([row, col])
            placed[node.id] = (row, col)
            result.append(Placed(
                node: node,
                row: row,
                col: col,
                externalPrerequisites: node.prerequisites.filter { !inSport.contains($0) }
            ))
        }
        nodes = result.sorted { ($0.row, $0.col) < ($1.row, $1.col) }
        rowCount = (result.map(\.row).max() ?? -1) + 1

        let distant = Self.distantNodeIds(sportNodes, byId: byId)
        edges = result.flatMap { child in
            child.node.prerequisites.filter(inSport.contains).compactMap { parentId -> Edge? in
                guard let parent = byId[parentId] else { return nil }
                let style: Edge.Style = parent.state == .unlocked && child.node.state == .unlocked
                    ? .active
                    : parent.state == .unlocked ? .reachable : .locked
                return Edge(fromId: parentId, toId: child.id, style: style, distant: distant.contains(child.id))
            }
        }
    }

    /// Mirrors the web atlas: a node is distant when it is not usable and none of its
    /// prerequisites is usable either, so the reachable frontier reads first.
    static func distantNodeIds(_ nodes: [SkillAtlasView_.Node], byId: [String: SkillAtlasView_.Node]) -> Set<String> {
        let usable: (SkillAtlasView_.Node.State?) -> Bool = { $0 == .unlocked || $0 == .unlockable }
        return Set(nodes.filter { node in
            guard node.branch != "root", !usable(node.state) else { return false }
            return !node.prerequisites.contains { usable(byId[$0]?.state) }
        }.map(\.id))
    }
}
