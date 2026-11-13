import XCTest
@testable import Staza

@MainActor
final class AddActivityModelTests: XCTestCase {
    private let item = #"{"id":"a1","type":"running","title":"Run","startedAt":"2026-01-02T08:00:00.000Z","xpEarned":10,"collectedCount":0,"flowlineCount":0}"#

    func testImportUploadsMultipartAndLoadsActivity() async {
        let transport = StubTransport([
            .init(status: 200, body: #"{"sport":"running"}"#),
            .init(status: 201, body: #"{"activity":{"id":"a1"},"inserted":true}"#),
            .init(status: 200, body: "[\(item)]")
        ])
        let model = AddActivityModel(api: APIClient(baseURL: baseURL, transport: transport))
        await model.select(fileName: "ride.fit", data: Data([1, 2, 3]))
        XCTAssertEqual(model.sport, .running)
        await model.upload()

        guard case .imported(let activity) = model.state else { return XCTFail("expected imported, got \(model.state)") }
        XCTAssertEqual(activity.id, "a1")
        let request = transport.requests[1]
        XCTAssertEqual(request.url?.path, "/api/activities/import")
        XCTAssertNotNil(request.value(forHTTPHeaderField: "Idempotency-Key"))
        XCTAssertTrue(request.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("multipart/form-data") == true)
        let body = String(decoding: request.httpBody ?? Data(), as: UTF8.self)
        XCTAssertTrue(body.contains("name=\"sport\"") && body.contains("filename=\"ride.fit\""))
    }

    func testServerErrorKeepsFileForRetry() async {
        let transport = StubTransport([
            .init(status: 400, body: "{}"),
            .init(status: 422, body: #"{"error":"Bad FIT"}"#)
        ])
        let model = AddActivityModel(api: APIClient(baseURL: baseURL, transport: transport))
        await model.select(fileName: "x.fit", data: Data([0]))
        await model.upload()
        XCTAssertEqual(model.state, .failed("Bad FIT"))
        XCTAssertTrue(model.hasFile)
    }
}
