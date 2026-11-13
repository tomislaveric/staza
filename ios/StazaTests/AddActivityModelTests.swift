import XCTest
@testable import Staza

@MainActor
final class AddActivityModelTests: XCTestCase {
    private let item = #"{"id":"a1","type":"running","title":"Run","startedAt":"2026-01-02T08:00:00.000Z","xpEarned":10,"collectedCount":0,"flowlineCount":0}"#
    private let imported = #"{"activity":{"id":"a1"},"inserted":true}"#

    func testImportStreamsMultipartAndLoadsActivityById() async throws {
        let transport = StubTransport([
            .init(status: 200, body: #"{"sport":"running"}"#),
            .init(status: 201, body: imported),
            .init(status: 200, body: item)
        ])
        let model = AddActivityModel(api: APIClient(baseURL: baseURL, transport: transport))
        await model.select(fileName: "ride.fit", fileURL: try makeTempFile(named: "ride.fit", bytes: [0xF1, 0x7E, 0x55]))
        XCTAssertEqual(model.sport, .running)
        XCTAssertFalse(model.sportDetectionFailed)
        await model.upload()

        guard case .imported(let activity) = model.state else { return XCTFail("expected imported, got \(model.state)") }
        XCTAssertEqual(activity.id, "a1")
        let request = transport.requests[1]
        XCTAssertEqual(request.url?.path, "/api/activities/import")
        XCTAssertNotNil(request.value(forHTTPHeaderField: "Idempotency-Key"))
        XCTAssertTrue(request.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("multipart/form-data") == true)
        let body = request.httpBody ?? Data()
        let text = String(decoding: body, as: UTF8.self)
        XCTAssertTrue(text.contains("name=\"sport\"") && text.contains("filename=\"ride.fit\""))
        XCTAssertNotNil(body.range(of: Data([0xF1, 0x7E, 0x55])))
        XCTAssertEqual(transport.requests[2].url?.path, "/api/activities/a1")
    }

    func testInspectFailureIsSurfacedAndFileKeptForRetry() async throws {
        let transport = StubTransport([
            .init(status: 400, body: "{}"),
            .init(status: 422, body: #"{"error":"Bad FIT"}"#)
        ])
        let model = AddActivityModel(api: APIClient(baseURL: baseURL, transport: transport))
        await model.select(fileName: "x.fit", fileURL: try makeTempFile(named: "x.fit", bytes: [0]))
        XCTAssertTrue(model.sportDetectionFailed)
        XCTAssertEqual(model.sport, .cycling)
        await model.upload()
        XCTAssertEqual(model.state, .failed("Bad FIT"))
        XCTAssertTrue(model.hasFile)
    }

    func testRetryReusesKeyButEachSelectedFileGetsANewOne() async throws {
        let transport = StubTransport([
            .init(status: 200, body: "{}"),
            .init(status: 500, body: "{}"),
            .init(status: 201, body: imported),
            .init(status: 200, body: item),
            .init(status: 200, body: "{}"),
            .init(status: 201, body: imported),
            .init(status: 200, body: item)
        ])
        let model = AddActivityModel(api: APIClient(baseURL: baseURL, transport: transport))
        await model.select(fileName: "a.fit", fileURL: try makeTempFile(named: "a.fit", bytes: [1]))
        await model.upload()
        await model.upload()
        await model.select(fileName: "b.fit", fileURL: try makeTempFile(named: "b.fit", bytes: [2]))
        await model.upload()

        let keys = transport.requests
            .filter { $0.url?.path == "/api/activities/import" }
            .map { $0.value(forHTTPHeaderField: "Idempotency-Key") }
        XCTAssertEqual(keys.count, 3)
        XCTAssertEqual(keys[0], keys[1])
        XCTAssertNotEqual(keys[1], keys[2])
    }

    func testFileSharedWhileUploadingStaysQueuedUntilUploadEnds() async throws {
        let transport = GatedTransport(gatedPath: "/api/activities/import", [
            .init(status: 200, body: "{}"),
            .init(status: 201, body: imported),
            .init(status: 200, body: item),
            .init(status: 200, body: "{}"),
            .init(status: 201, body: imported),
            .init(status: 200, body: item)
        ])
        let model = AddActivityModel(api: APIClient(baseURL: baseURL, transport: transport))
        let container = AppContainer(transport: StubTransport([]), store: MemoryCredentialStore())
        await model.select(fileName: "first.fit", fileURL: try makeTempFile(named: "first.fit", bytes: [1]))
        let upload = Task { await model.upload() }
        while !model.isBusy { await Task.yield() }

        container.receive(fileURL: try makeTempFile(named: "shared.fit", bytes: [2]))
        let consumedWhileBusy = await model.importPending(from: container)
        XCTAssertFalse(consumedWhileBusy)
        XCTAssertNotNil(container.pendingImport)

        transport.open()
        await upload.value
        let consumedAfter = await model.importPending(from: container)
        XCTAssertTrue(consumedAfter)
        XCTAssertNil(container.pendingImport)
        let uploaded = transport.inner.requests
            .filter { $0.url?.path == "/api/activities/import" }
            .map { String(decoding: $0.httpBody ?? Data(), as: UTF8.self) }
        XCTAssertEqual(uploaded.count, 2)
        XCTAssertTrue(uploaded[1].contains("filename=\"shared.fit\""))
    }
}
