import XCTest
@testable import Staza

@MainActor
final class QuestListModelTests: XCTestCase {
    private struct Transport: HTTPTransport {
        let status: Int
        let body: String
        func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
            (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
        }
    }

    private func quest(_ id: String, chain: String, step: Int, state: String) -> String {
        #"{"id":"\#(id)","chainId":"c","chainTitle":"\#(chain)","step":\#(step),"totalSteps":2,"title":"T","description":"D","difficulty":"easy","xp":10,"state":"\#(state)"}"#
    }

    func testGroupsChainsAndPutsUnlockedFirst() async {
        let body = "{\"quests\":[" + [
            quest("a:2", chain: "Locked", step: 2, state: "locked"),
            quest("a:1", chain: "Locked", step: 1, state: "locked"),
            quest("b:1", chain: "Open", step: 1, state: "active")
        ].joined(separator: ",") + "]}"
        let model = QuestListModel(api: APIClient(baseURL: baseURL, transport: Transport(status: 200, body: body)))
        await model.load()
        XCTAssertEqual(model.chains.map(\.title), ["Open", "Locked"])
        XCTAssertEqual(model.chains[1].quests.map(\.id), ["a:1", "a:2"])
        XCTAssertFalse(model.failed)
    }

    func testLoadFailureFlagged() async {
        let model = QuestListModel(api: APIClient(baseURL: baseURL, transport: Transport(status: 500, body: "{}")))
        await model.load()
        XCTAssertTrue(model.failed)
    }
}
