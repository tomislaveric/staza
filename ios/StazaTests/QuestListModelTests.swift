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

    func testSectionsActiveFirstThenUpcomingChainsThenFinished() async {
        let body = "{\"quests\":[" + [
            quest("a:1", chain: "Flow Hunter", step: 1, state: "completed"),
            quest("a:2", chain: "Flow Hunter", step: 2, state: "active"),
            quest("b:1", chain: "Breakaway", step: 1, state: "completed"),
            quest("b:2", chain: "Breakaway", step: 2, state: "completed"),
            quest("c:1", chain: "Climber", step: 1, state: "active"),
            quest("c:2", chain: "Climber", step: 2, state: "locked")
        ].joined(separator: ",") + "]}"
        let model = QuestListModel(api: APIClient(baseURL: baseURL, transport: Transport(status: 200, body: body)))
        await model.load()
        XCTAssertEqual(model.activeQuests.map(\.id), ["a:2", "c:1"])
        XCTAssertEqual(model.upcomingChains.map(\.title), ["Climber"])
        XCTAssertEqual(model.finishedQuests.map(\.id), ["a:1", "b:1", "b:2"])
    }

    func testLoadFailureFlagged() async {
        let model = QuestListModel(api: APIClient(baseURL: baseURL, transport: Transport(status: 500, body: "{}")))
        await model.load()
        XCTAssertTrue(model.failed)
    }

    func testDecodesCompactCardFields() async {
        let body = #"{"quests":[{"id":"a:1","chainTitle":"C","step":1,"totalSteps":2,"title":"T","description":"D","difficulty":"hard","xp":10,"state":"active","isNew":true,"lastFailure":{"attemptCount":2,"criteria":[{"label":"Ride","current":12.5,"required":30,"unit":"km","met":false}]},"requiredNode":{"id":"n","name":"Climber","premium":true}}]}"#
        let model = QuestListModel(api: APIClient(baseURL: baseURL, transport: Transport(status: 200, body: body)))
        await model.load()
        let quest = model.quests.first
        XCTAssertEqual(quest?.isNew, true)
        XCTAssertEqual(quest?.requiredNode?.premium, true)
        let criterion = quest?.lastFailure?.criteria?.first
        XCTAssertEqual(criterion?.current, 12.5)
        XCTAssertEqual(criterion?.required, 30)
        XCTAssertEqual(criterion?.unit, "km")
        if let criterion {
            XCTAssertEqual(QuestPills.criterion(criterion, locale: Locale(identifier: "en_US")), "12.5/30 km")
        }
    }
}
