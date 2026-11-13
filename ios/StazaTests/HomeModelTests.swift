import XCTest
@testable import Staza

@MainActor
final class HomeModelTests: XCTestCase {
    private let progressJSON = #"{"totalXp":150,"level":2,"currentLevelXp":50,"nextLevelXp":200,"progressToNextLevel":50,"remainingXp":150,"progressPercent":25}"#
    private func quest(_ id: String, status: String, completed: Int) -> String {
        #"{"id":"\#(id)","title":"Quest \#(id)","description":"d","status":"\#(status)","difficulty":"easy","rewardXp":100,"objectives":[{"objective":{"type":"x"},"progress":{"completed":\#(completed),"required":4,"complete":false}}]}"#
    }

    // Requests run concurrently, so stubs are keyed by path rather than order.
    private struct PathTransport: HTTPTransport {
        let responses: [String: (Int, String)]
        func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
            let (status, body) = responses[request.url!.path] ?? (404, "{}")
            return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
        }
    }

    private func model(_ stubs: [StubTransport.Stub]) -> (HomeModel, Void) {
        let responses = ["/api/player/progress": (stubs[0].status, stubs[0].body), "/api/quest-instances": (stubs[1].status, stubs[1].body)]
        return (HomeModel(api: APIClient(baseURL: baseURL, transport: PathTransport(responses: responses))), ())
    }

    func testLoadsProgressAndOnlyActiveQuests() async {
        let body = #"{"instances":[\#(quest("a", status: "active", completed: 1)),\#(quest("b", status: "completed", completed: 4))]}"#
        let (model, _) = model([.init(status: 200, body: progressJSON), .init(status: 200, body: body)])
        await model.load()
        guard case .loaded(let content) = model.state else { return XCTFail("expected loaded") }
        XCTAssertEqual(content.progress.level, 2)
        XCTAssertEqual(content.activeQuests.map(\.id), ["a"])
        XCTAssertEqual(content.activeQuests[0].completionFraction, 0.25, accuracy: 0.001)
    }

    func testEmptyQuestsLoads() async {
        let (model, _) = model([.init(status: 200, body: progressJSON), .init(status: 200, body: #"{"instances":[]}"#)])
        await model.load()
        guard case .loaded(let content) = model.state else { return XCTFail("expected loaded") }
        XCTAssertTrue(content.activeQuests.isEmpty)
    }

    func testFailureSurfacesError() async {
        let (model, _) = model([.init(status: 500, body: #"{"error":"boom"}"#), .init(status: 500, body: #"{"error":"boom"}"#)])
        await model.load()
        XCTAssertEqual(model.state, .failed("boom"))
    }
}
