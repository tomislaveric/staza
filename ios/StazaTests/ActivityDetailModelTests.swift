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
