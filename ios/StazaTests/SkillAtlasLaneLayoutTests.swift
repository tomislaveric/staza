import XCTest
@testable import Staza

final class SkillAtlasLaneLayoutTests: XCTestCase {
    private func node(
        _ id: String,
        sport: String = "cycling",
        branch: String,
        pre: [String] = [],
        state: SkillAtlasView_.Node.State = .locked
    ) -> SkillAtlasView_.Node {
        SkillAtlasView_.Node(
            id: id, name: id, description: "", sport: sport, branch: branch, tier: .level(1), cost: 1,
            premium: false, grant: .init(type: "quest_unlock", label: id), prerequisites: pre,
            layout: .init(col: 0, row: 0), state: state, requirements: []
        )
    }

    private func position(_ layout: SkillAtlasLaneLayout, _ id: String) -> [Int]? {
        layout.nodes.first { $0.id == id }.map { [$0.row, $0.col] }
    }

    func testHubAndLanesFollowPrerequisiteDepth() {
        let layout = SkillAtlasLaneLayout(nodes: [
            node("hub", branch: "root"),
            node("flow1", branch: "rush", pre: ["hub"]),
            node("flow2", branch: "rush", pre: ["flow1"]),
            node("explore1", branch: "adventure", pre: ["hub"]),
            node("endurance1", branch: "endurance", pre: ["hub"])
        ], sport: "cycling")

        XCTAssertEqual(position(layout, "hub"), [0, 2])
        XCTAssertEqual(position(layout, "flow1"), [1, 0])
        XCTAssertEqual(position(layout, "flow2"), [2, 0])
        XCTAssertEqual(position(layout, "explore1"), [1, 2])
        XCTAssertEqual(position(layout, "endurance1"), [1, 4])
        XCTAssertEqual(layout.rowCount, 3)
        XCTAssertEqual(layout.lanes.map(\.branch), ["rush", "adventure", "endurance"])
    }

    func testCrossNodesSitInTheGutterBetweenTheirParents() {
        let layout = SkillAtlasLaneLayout(nodes: [
            node("hub", branch: "root"),
            node("flow1", branch: "rush", pre: ["hub"]),
            node("explore1", branch: "adventure", pre: ["hub"]),
            node("explore2", branch: "adventure", pre: ["explore1"]),
            node("endurance1", branch: "endurance", pre: ["hub"]),
            node("fastExplorer", branch: "cross", pre: ["flow1", "explore1"]),
            node("breakaway", branch: "cross", pre: ["flow1", "endurance1"])
        ], sport: "cycling")

        XCTAssertEqual(position(layout, "fastExplorer"), [2, 1])
        // The centre lane is taken by explore2, so it moves to the nearest free gutter.
        XCTAssertEqual(position(layout, "breakaway"), [2, 3])
    }

    func testOccupiedCellPushesNodeAndDescendantsDown() {
        let layout = SkillAtlasLaneLayout(nodes: [
            node("hub", branch: "root"),
            node("a", branch: "cross", pre: ["hub"]),
            node("b", branch: "cross", pre: ["hub"]),
            node("c", branch: "cross", pre: ["hub"]),
            node("d", branch: "cross", pre: ["hub"]),
            node("child", branch: "cross", pre: ["d"])
        ], sport: "cycling")

        XCTAssertEqual(position(layout, "a"), [1, 2])
        XCTAssertEqual(position(layout, "b"), [1, 1])
        XCTAssertEqual(position(layout, "c"), [1, 3])
        XCTAssertEqual(position(layout, "d"), [2, 2])
        XCTAssertEqual(position(layout, "child"), [3, 2])
    }

    func testOtherSportPrerequisitesBecomeExternalReferencesAndEdgesCarryState() {
        let layout = SkillAtlasLaneLayout(nodes: [
            node("cyclist", branch: "root", state: .unlocked),
            node("runner", sport: "running", branch: "root", state: .unlocked),
            node("flow1", branch: "rush", pre: ["cyclist"], state: .unlocked),
            node("flow2", branch: "rush", pre: ["flow1"], state: .unlockable),
            node("flow3", branch: "rush", pre: ["flow2"]),
            node("flow4", branch: "rush", pre: ["flow3"]),
            node("warrior", branch: "cross_sport", pre: ["cyclist", "runner"]),
            node("mover", branch: "cross_sport", pre: ["runner"])
        ], sport: "cycling")

        // Only reachable from another sport: placed below the whole tree.
        XCTAssertEqual(position(layout, "mover"), [5, 2])

        XCTAssertFalse(layout.nodes.contains { $0.id == "runner" })
        XCTAssertEqual(layout.nodes.first { $0.id == "warrior" }?.externalPrerequisites, ["runner"])
        XCTAssertFalse(layout.edges.contains { $0.fromId == "runner" })
        let style = { (to: String) in layout.edges.first { $0.toId == to }?.style }
        XCTAssertEqual(style("flow1"), .active)
        XCTAssertEqual(style("flow2"), .reachable)
        XCTAssertEqual(style("flow3"), .locked)
        XCTAssertEqual(layout.edges.first { $0.toId == "flow3" }?.distant, false)
        XCTAssertEqual(layout.edges.first { $0.toId == "flow4" }?.distant, true)
    }
}
