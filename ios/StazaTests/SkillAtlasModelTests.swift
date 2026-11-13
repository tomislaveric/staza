import XCTest
@testable import Staza

@MainActor
final class SkillAtlasModelTests: XCTestCase {
    private struct Transport: HTTPTransport {
        let responses: [(Int, String)]
        let counter = Counter()
        final class Counter: @unchecked Sendable { var index = 0 }
        func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
            let (status, body) = responses[min(counter.index, responses.count - 1)]
            counter.index += 1
            return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
        }
    }

    private func atlas(state: String, balance: Int) -> String {
        #"{"isPremium":false,"earnedPoints":2,"spentPoints":\#(2 - balance),"balance":\#(balance),"nextSkillPoint":{"level":5,"xpRemaining":120,"progress":0.4},"nodes":[{"id":"n1","name":"Node","description":"D","sport":"cycling","branch":"root","tier":1,"cost":1,"premium":false,"grant":{"type":"badge","value":"b","label":"Badge"},"prerequisites":[],"layout":{"col":1.5,"row":0},"state":"\#(state)","requirements":[{"metric":"level","target":2,"label":"Reach level 2","current":2,"met":true}]}]}"#
    }

    func testLoadAndUnlockUpdatesState() async throws {
        let transport = Transport(responses: [(200, atlas(state: "unlockable", balance: 2)), (201, atlas(state: "unlocked", balance: 1))])
        let model = SkillAtlasModel(api: APIClient(baseURL: baseURL, transport: transport))
        await model.load()
        XCTAssertEqual(model.visibleNodes.first?.state, .unlockable)
        await model.unlock(try XCTUnwrap(model.visibleNodes.first))
        XCTAssertEqual(model.visibleNodes.first?.state, .unlocked)
        XCTAssertEqual(model.atlas?.balance, 1)
        XCTAssertNil(model.unlockError)
    }

    func testUnlockRejectionSurfacesError() async throws {
        let transport = Transport(responses: [
            (200, atlas(state: "unlockable", balance: 2)),
            (409, #"{"error":"Not enough points.","code":"insufficient_points"}"#),
            (200, atlas(state: "locked", balance: 0))
        ])
        let model = SkillAtlasModel(api: APIClient(baseURL: baseURL, transport: transport))
        await model.load()
        await model.unlock(try XCTUnwrap(model.visibleNodes.first))
        XCTAssertEqual(model.unlockError, "Not enough points.")
        XCTAssertEqual(model.visibleNodes.first?.state, .locked)
    }
}
