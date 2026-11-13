import XCTest
@testable import Staza

@MainActor
final class StravaImportModelTests: XCTestCase {
    private struct StubAuthenticator: StravaWebAuthenticating {
        let result: Result<URL, StravaAuthError>
        func authenticate(url: URL, callbackScheme: String) async throws -> URL { try result.get() }
    }

    private let activity = #"{"id":"1001","name":"Ride","activityType":"cycling","beforeJourneyStart":false}"#
    private let history = #"{"id":"a1","type":"cycling","title":"Ride","startedAt":"2026-01-02T08:00:00.000Z","xpEarned":10,"collectedCount":0,"flowlineCount":0}"#

    private func model(_ stubs: [StubTransport.Stub], auth: Result<URL, StravaAuthError> = .failure(.cancelled)) -> (StravaImportModel, StubTransport) {
        let transport = StubTransport(stubs)
        return (StravaImportModel(api: APIClient(baseURL: baseURL, transport: transport), authenticator: StubAuthenticator(result: auth), locale: "en"), transport)
    }

    func testConnectedStatusListsActivities() async {
        let (model, _) = model([
            .init(status: 200, body: #"{"enabled":true,"status":"connected"}"#),
            .init(status: 200, body: #"{"activities":[\#(activity)]}"#)
        ])
        await model.load()
        XCTAssertEqual(model.state, .connected(try! JSONDecoder().decode(StravaRecentActivitiesResponse.self, from: Data(#"{"activities":[\#(activity)]}"#.utf8)).activities))
    }

    func testConnectCompletesCodeWithOwnSessionThenLoadsActivities() async throws {
        let (model, transport) = model([
            .init(status: 200, body: #"{"authorizationUrl":"https://strava.test/authorize"}"#),
            .init(status: 200, body: #"{"outcome":"connected"}"#),
            .init(status: 200, body: #"{"activities":[]}"#)
        ], auth: .success(URL(string: "staza://strava?code=c1&state=s%2F1&scope=read,activity:read_all")!))
        await model.connect()
        XCTAssertEqual(model.state, .connected([]))
        XCTAssertEqual(transport.requests[0].url?.path, "/api/integrations/strava/authorize")
        XCTAssertTrue(String(decoding: transport.requests[0].httpBody ?? Data(), as: UTF8.self).contains(#""client":"native""#))
        XCTAssertEqual(transport.requests[1].url?.path, "/api/integrations/strava/native/complete")
        let body = try JSONSerialization.jsonObject(with: transport.requests[1].httpBody ?? Data()) as? [String: String]
        XCTAssertEqual(body, ["code": "c1", "state": "s/1", "scope": "read,activity:read_all"])
    }

    func testRejectedNativeCompletionShowsError() async {
        let (model, _) = model([
            .init(status: 200, body: #"{"authorizationUrl":"https://strava.test/authorize"}"#),
            .init(status: 200, body: #"{"outcome":"invalid_state"}"#)
        ], auth: .success(URL(string: "staza://strava?code=c1&state=s1&scope=activity:read_all")!))
        await model.connect()
        XCTAssertEqual(model.state, .disconnected(message: .error))
    }

    func testMissingScopeOutcomeFromCallback() async {
        let (model, transport) = model([
            .init(status: 200, body: #"{"authorizationUrl":"https://strava.test/authorize"}"#)
        ], auth: .success(URL(string: "staza://strava?outcome=missing_scope")!))
        await model.connect()
        XCTAssertEqual(model.state, .disconnected(message: .missingScope))
        XCTAssertEqual(transport.requests.count, 1)
    }

    func testDeniedAndCancelledStayDisconnected() async {
        let (denied, _) = model([.init(status: 200, body: #"{"authorizationUrl":"https://strava.test/a"}"#)], auth: .success(URL(string: "staza://strava?outcome=denied")!))
        await denied.connect()
        XCTAssertEqual(denied.state, .disconnected(message: .denied))
        let (cancelled, _) = model([.init(status: 200, body: #"{"authorizationUrl":"https://strava.test/a"}"#)])
        await cancelled.connect()
        XCTAssertEqual(cancelled.state, .disconnected(message: nil))
    }

    func testImportLoadsProcessedActivity() async {
        let (model, transport) = model([
            .init(status: 201, body: #"{"activity":{"id":"a1"},"inserted":true}"#),
            .init(status: 200, body: history),
            .init(status: 200, body: #"{"activities":[]}"#)
        ])
        let item = try! JSONDecoder().decode(StravaRecentActivity.self, from: Data(activity.utf8))
        await model.importActivity(item)
        XCTAssertEqual(model.imported?.id, "a1")
        XCTAssertEqual(transport.requests[0].url?.path, "/api/integrations/strava/activities/1001/import")
        XCTAssertEqual(transport.requests[1].url?.path, "/api/activities/a1")
    }

    func testReconnectRequiredReturnsToDisconnected() async {
        let (model, _) = model([.init(status: 409, body: #"{"error":"x","code":"reconnect_required"}"#)])
        await model.loadActivities()
        XCTAssertEqual(model.state, .disconnected(message: .error))
    }
}
