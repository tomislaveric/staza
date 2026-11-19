import XCTest
@testable import Staza

@MainActor
final class ActivityDetailModelTests: XCTestCase {
    private struct PathTransport: HTTPTransport {
        let status: Int
        let body: String
        func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
            XCTAssertEqual(request.url!.path, "/api/activities/a1")
            return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
        }
    }

    private let detail = #"{"id":"a1","type":"run","title":"Morning run","startedAt":"2026-01-02T08:00:00.000Z","distanceMeters":5000,"xpEarned":120,"collectedCount":1,"revisitCount":1,"flowlineCount":0,"hasVideo":false,"events":[{"id":"e1","sourceId":"c1","type":"collectible_collected","collectible":{"name":"Castle","type":"landmark"},"value":50,"latitude":1,"longitude":2,"activityTimestamp":3,"repeat":true}],"replay":{"version":1,"activityResult":{"nearMisses":[{"collectibleId":"c2","name":"Peak","value":10,"minimumDistanceMeters":120}]}}}"#

    private func model(status: Int, body: String) -> ActivityDetailModel {
        ActivityDetailModel(api: APIClient(baseURL: baseURL, transport: PathTransport(status: status, body: body)), activityId: "a1")
    }

    func testLoadsEventsAndNearMisses() async {
        let model = model(status: 200, body: detail)
        await model.load()
        guard case .loaded(let detail) = model.state else { return XCTFail("expected loaded") }
        XCTAssertEqual(detail.events.map(\.collectible.name), ["Castle"])
        XCTAssertTrue(detail.events[0].isRepeat)
        XCTAssertEqual(detail.nearMisses.map(\.name), ["Peak"])
    }

    func testMissingReplayYieldsNoNearMisses() async {
        let body = #"{"id":"a1","type":"run","title":"T","startedAt":"2026-01-02T08:00:00Z","xpEarned":0,"collectedCount":0,"flowlineCount":0,"events":[]}"#
        let model = model(status: 200, body: body)
        await model.load()
        guard case .loaded(let detail) = model.state else { return XCTFail("expected loaded") }
        XCTAssertTrue(detail.nearMisses.isEmpty)
    }

    func testNotFoundSurfacesError() async {
        let model = model(status: 404, body: #"{"error":"Activity not found."}"#)
        await model.load()
        XCTAssertEqual(model.state, .failed("Activity not found."))
    }
}

final class ReplayTimelineTests: XCTestCase {
    private func pt(_ lat: Double, _ t: Double) -> ReplayTrackPoint { .init(latitude: lat, longitude: 0, timestampMs: t) }

    private var timeline: ReplayTimeline {
        ReplayTimeline(route: [pt(0, 0), pt(10, 1000), pt(20, 3000)], reveals: [
            .init(id: "late", name: "B", kind: .flowline, isRepeat: false, timestampMs: 2500, coordinate: nil),
            .init(id: "early", name: "A", kind: .collectible, isRepeat: false, timestampMs: 500, coordinate: nil)
        ])
    }

    func testInterpolatesPositionByTimestamp() {
        XCTAssertEqual(timeline.position(atMs: 500)?.latitude ?? -1, 5, accuracy: 0.001)
        XCTAssertEqual(timeline.position(atMs: 2000)?.latitude ?? -1, 15, accuracy: 0.001)
        XCTAssertEqual(timeline.position(atMs: 9999)?.latitude, 20)
    }

    func testRevealsItemsOnlyOnceTimestampReached() {
        XCTAssertTrue(timeline.revealed(atMs: 100).isEmpty)
        XCTAssertEqual(timeline.revealed(atMs: 1000).map(\.id), ["early"])
        XCTAssertEqual(timeline.revealed(atMs: 3000).map(\.id), ["early", "late"])
    }

    func testEventCategoryPrefersStoredCategoryOverType() throws {
        let json = #"[{"id":"e1","collectible":{"name":"Rigi","type":"landmark"},"collectibleCategory":"peak","value":1,"latitude":1,"longitude":2,"activityTimestamp":3},{"id":"e2","collectible":{"name":"Gotthard","type":"mountain_pass"},"value":1,"latitude":1,"longitude":2,"activityTimestamp":4}]"#
        let events = try JSONDecoder().decode([ActivityDetailEvent].self, from: Data(json.utf8))
        XCTAssertEqual(events.map(\.category), ["peak", "mountain_pass"])
    }

    func testFlowlineRevealCarriesCompletedSegmentGeometry() throws {
        let json = #"{"id":"a1","type":"ride","title":"Ride","startedAt":"2026-01-02T08:00:00.000Z","xpEarned":0,"collectedCount":0,"flowlineCount":2,"events":[],"replay":{"activity":{"route":[{"latitude":0,"longitude":0,"timestampMs":0},{"latitude":1,"longitude":1,"timestampMs":1000}]},"activityResult":{"fartlekCompletions":[{"fartlekName":"River","completedAtTimestampMs":500,"hiddenFound":true,"fartlekGeometry":{"type":"LineString","coordinates":[[8.1,47.2],[8.2,47.3]]}},{"fartlekName":"Legacy","completedAtTimestampMs":900}]}}}"#
        let detail = try JSONDecoder().decode(ActivityDetail.self, from: Data(json.utf8))
        let flowlines = try XCTUnwrap(ReplayTimeline(detail: detail)).reveals.filter { $0.kind == .flowline }
        XCTAssertEqual(flowlines.map(\.name), ["River", "Legacy"])
        XCTAssertEqual(flowlines[0].path, [ReplayCoordinate(latitude: 47.2, longitude: 8.1), ReplayCoordinate(latitude: 47.3, longitude: 8.2)])
        XCTAssertEqual(flowlines[1].path, [])
        XCTAssertEqual(flowlines.map(\.hiddenFound), [true, false])
    }

    func testBasemapPaletteFallsBackToWebDefaults() throws {
        let json = ##"{"styleUrl":"https://x/style.json","palette":{"activityRoute":"#112233","flowline":"not-a-color"}}"##
        let basemap = try JSONDecoder().decode(Basemap.self, from: Data(json.utf8))
        XCTAssertEqual(basemap.mapPalette.activityRoute, "#112233")
        XCTAssertEqual(basemap.mapPalette.flowline, MapPalette.standard.flowline)
        XCTAssertEqual(basemap.mapPalette.flowlineCompleted, "#e8b80a")
        let legacy = try JSONDecoder().decode(Basemap.self, from: Data(#"{"styleUrl":"https://x/style.json"}"#.utf8))
        XCTAssertEqual(legacy.mapPalette, .standard)
    }

    func testTraveledEndsAtCurrentPosition() {
        let path = timeline.traveled(atMs: 2000)
        XCTAssertEqual(path.count, 3)
        XCTAssertEqual(path.last?.latitude ?? -1, 15, accuracy: 0.001)
    }
}
