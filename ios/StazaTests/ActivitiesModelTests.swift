import XCTest
@testable import Staza

@MainActor
final class ActivitiesModelTests: XCTestCase {
    private struct PathTransport: HTTPTransport {
        let responses: [String: (Int, String)]
        func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
            let (status, body) = responses[request.url!.path] ?? (404, "{}")
            return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
        }
    }

    private let summary = #"{"count":1,"distanceMeters":5000,"xp":120,"collected":2,"flowlines":1}"#
    private let item = #"{"id":"a1","type":"run","title":"Morning run","startedAt":"2026-01-02T08:00:00.000Z","distanceMeters":5000,"xpEarned":120,"collectedCount":2,"revisitCount":0,"flowlineCount":1,"hasVideo":false}"#

    private func model(list: (Int, String), summary: (Int, String)) -> ActivitiesModel {
        ActivitiesModel(api: APIClient(baseURL: baseURL, transport: PathTransport(responses: [
            "/api/activities": list, "/api/activities/summary": summary
        ])))
    }

    func testLoadsActivitiesInServerOrderWithSummary() async {
        let model = model(list: (200, "[\(item)]"), summary: (200, summary))
        await model.load()
        guard case .loaded(let content) = model.state else { return XCTFail("expected loaded") }
        XCTAssertEqual(content.activities.map(\.id), ["a1"])
        XCTAssertNotNil(content.activities[0].startedDate)
        XCTAssertEqual(content.summary.count, 1)
    }

    func testFailureSurfacesError() async {
        let model = model(list: (500, #"{"error":"boom"}"#), summary: (500, #"{"error":"boom"}"#))
        await model.load()
        XCTAssertEqual(model.state, .failed("boom"))
    }
}
