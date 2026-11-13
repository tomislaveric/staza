import XCTest
@testable import Staza

@MainActor
final class WorldSheetModelTests: XCTestCase {
    private let selection = WorldSelection.collectible(WorldCollectible(id: "c1", name: "Peak", latitude: 47, longitude: 8, found: false, primaryCategory: "peak"))

    func testDetailReturnsToTheModeItWasOpenedFrom() {
        let sheet = WorldSheetModel()
        sheet.startExplore()
        sheet.showDetail(selection)
        sheet.showDetail(.flowline(WorldFlowline(id: "f1", name: "Flow", geometry: .init(coordinates: []), completed: false)))
        XCTAssertEqual(sheet.selection?.id, "flowline:f1")
        sheet.closeDetail()
        XCTAssertEqual(sheet.mode, .explore)
    }

    func testEndingExploreUnderADetailReturnsToBrowse() {
        let sheet = WorldSheetModel()
        sheet.startExplore()
        sheet.showDetail(selection)
        sheet.endExplore()
        XCTAssertEqual(sheet.mode, .detail(selection))
        sheet.closeDetail()
        XCTAssertEqual(sheet.mode, .browse)
    }

    func testDetailExpandsCollapsedSheetAndRevealKeepsMapVisible() {
        let sheet = WorldSheetModel()
        sheet.showDetail(selection)
        XCTAssertEqual(sheet.detent, .medium)
        sheet.detent = .large
        sheet.revealMap()
        XCTAssertEqual(sheet.detent, .medium)
    }
}
