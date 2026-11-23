import XCTest
@testable import Staza

final class WorldFiltersTests: XCTestCase {
    private func collectible(_ id: String, found: Bool, category: String? = nil, visibility: String? = nil) -> WorldCollectible {
        WorldCollectible(id: id, name: id, latitude: 47, longitude: 8, found: found, primaryCategory: category, visibility: visibility)
    }

    private func flowline(_ id: String, completed: Bool = false, length: Double? = nil, score: Double? = nil) -> WorldFlowline {
        WorldFlowline(id: id, name: id, geometry: .init(coordinates: [[8, 47], [8.1, 47.1]]), completed: completed, lengthMeters: length, flowScore: score)
    }

    func testAvailableFiltersFollowViewportContentAndGrants() {
        let filters = WorldFilters.available(
            collectibles: [collectible("a", found: true, category: "peak"), collectible("h", found: false, category: "castle", visibility: "hidden")],
            flowlines: [],
            granted: ["high-flow", "unknown"]
        )
        XCTAssertEqual(filters, [.found, .peak, .highFlow])
    }

    func testSelectedFiltersUseUnionAndKeepFlowlinesIndependent() {
        let items = [collectible("peak", found: true, category: "peak"), collectible("castle", found: false, category: "castle"), collectible("view", found: false, category: "viewpoint")]
        let lines = [flowline("short", score: 80), flowline("long", completed: true, length: 6000)]

        XCTAssertEqual(WorldFilters.collectibles(items, selected: []).map(\.id), ["peak", "castle", "view"])
        XCTAssertEqual(WorldFilters.collectibles(items, selected: [.found, .castle]).map(\.id), ["peak", "castle"])
        XCTAssertEqual(WorldFilters.flowlines(lines, selected: [.found]).map(\.id), [])
        XCTAssertEqual(WorldFilters.flowlines(lines, selected: [.found, .flowlines]).map(\.id), ["short", "long"])
    }

    func testAdvancedFilterRules() {
        let items = [collectible("peak", found: true, category: "peak"), collectible("castle", found: false, category: "castle")]
        let lines = [flowline("flow", length: 4999.99, score: 82.01), flowline("long", completed: true, length: 5000), flowline("plain", score: 10)]

        XCTAssertEqual(WorldFilters.collectibles(items, selected: [.undiscoveredOnly]).map(\.id), ["castle"])
        XCTAssertEqual(WorldFilters.flowlines(lines, selected: [.undiscoveredOnly]).map(\.id), ["flow", "plain"])
        XCTAssertEqual(WorldFilters.collectibles(items, selected: [.peaksOnly]).map(\.id), ["peak"])
        XCTAssertEqual(WorldFilters.flowlines(lines, selected: [.peaksOnly]).map(\.id), [])
        XCTAssertEqual(WorldFilters.flowlines(lines, selected: [.highFlow]).map(\.id), ["flow"])
        XCTAssertEqual(WorldFilters.flowlines(lines, selected: [.longEndurance]).map(\.id), ["long"])
    }

    func testHighFlowFilterMatchesCharacterBoundariesAndLongFilterStaysLengthOnly() {
        let lines = [
            flowline("exact-score", length: 4000, score: 82),
            flowline("high-flow", length: 4999.99, score: 82.01),
            flowline("exact-length", length: 5000, score: 100),
            flowline("missing-length", score: 100)
        ]
        XCTAssertEqual(WorldFilters.flowlines(lines, selected: [.highFlow]).map(\.id), ["high-flow"])
        XCTAssertEqual(WorldFilters.flowlines(lines, selected: [.longEndurance]).map(\.id), ["exact-length"])
        for line in lines {
            XCTAssertEqual(WorldFilter.highFlow.matches(line), line.resolvedCharacter.primary == .flow)
        }
    }

    func testMapIconNamesFollowCategoryAndFoundState() {
        XCTAssertEqual(CollectibleMapIcons.imageName(category: "peak", found: true), "collectible-peak")
        XCTAssertEqual(CollectibleMapIcons.imageName(category: "mountain_pass", found: false), "collectible-mountain_pass-muted")
        XCTAssertNil(CollectibleMapIcons.imageName(category: "coin", found: true))
        XCTAssertNil(CollectibleMapIcons.imageName(category: nil, found: false))
    }
}
