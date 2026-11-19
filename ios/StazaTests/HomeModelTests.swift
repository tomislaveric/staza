import XCTest
@testable import Staza

@MainActor
final class HomeModelTests: XCTestCase {
    private static let dashboard = #"{"progress":{"totalXp":1075,"level":5,"currentLevelXp":75,"nextLevelXp":500,"progressToNextLevel":0.15,"remainingXp":425,"progressPercent":15},"lifetime":{"distanceMeters":137300,"totalCollectibles":2,"totalFlowlines":11},"sportRecords":[],"milestones":{"places":0,"peaks":0,"mountainPasses":0,"flowlines":11},"recentActivities":[],"questHistory":[]}"#
    private static let activities = #"[{"id":"a1","type":"cycling","title":"Ride","startedAt":"2026-11-08T10:00:00.000Z","distanceMeters":137300,"durationSeconds":20760,"xpEarned":1075,"collectedCount":2,"revisitCount":1,"flowlineCount":11,"hasVideo":true}]"#
    private static let detail = #"{"id":"a1","type":"cycling","title":"Ride","startedAt":"2026-11-08T10:00:00.000Z","distanceMeters":137300,"durationSeconds":20760,"xpEarned":1075,"collectedCount":2,"revisitCount":1,"flowlineCount":11,"hasVideo":true,"events":[{"id":"e1","collectible":{"name":"Col du Pigeonnier","type":"mountain_pass"},"value":100,"latitude":49.0,"longitude":7.9,"activityTimestamp":1500}],"replay":{"activity":{"route":[{"latitude":49.0,"longitude":7.9,"timestampMs":1000},{"latitude":49.1,"longitude":8.0,"timestampMs":2000}]},"activityResult":{"nearMisses":[]}}}"#
    private static let skillTree = #"{"isPremium":false,"earnedPoints":5,"spentPoints":0,"balance":5,"nextSkillPoint":{"level":6,"xpRemaining":425,"progress":0.15},"nodes":[\#(node("n1", "unlocked")),\#(node("n2", "locked"))]}"#
    private static let capabilities = #"{"titles":[{"id":"t1","label":"Climber"}],"badges":[]}"#

    private static func node(_ id: String, _ state: String) -> String {
        #"{"id":"\#(id)","name":"Node","description":"D","sport":"cycling","branch":"root","cost":1,"premium":false,"grant":{"label":"Badge"},"prerequisites":[],"layout":{"col":0,"row":0},"state":"\#(state)","requirements":[]}"#
    }

    private static func instance(_ id: String, status: String) -> String {
        #"{"id":"\#(id)","title":"Exploration \#(id)","description":"d","status":"\#(status)","difficulty":"easy","rewardXp":100,"objectives":[]}"#
    }

    private static func authored(_ id: String, state: String, failed: Bool = false) -> String {
        let failure = failed ? #","lastFailure":{"attemptCount":1}"# : ""
        return #"{"id":"\#(id)","chainTitle":"Chain","step":1,"totalSteps":3,"title":"Quest \#(id)","description":"D","difficulty":"easy","xp":200,"state":"\#(state)"\#(failure)}"#
    }

    // Requests run concurrently, so stubs are keyed by path rather than order.
    private final class PathTransport: HTTPTransport, @unchecked Sendable {
        let responses: [String: (Int, String)]
        private let lock = NSLock()
        private(set) var paths: [String] = []
        init(_ responses: [String: (Int, String)]) { self.responses = responses }
        func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
            lock.withLock { paths.append(request.url!.path) }
            let (status, body) = responses[request.url!.path] ?? (404, #"{"error":"missing"}"#)
            return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
        }
    }

    private func responses(activities: String? = nil, overrides: [String: (Int, String)] = [:]) -> [String: (Int, String)] {
        var all: [String: (Int, String)] = [
            "/api/player/progress-dashboard": (200, Self.dashboard),
            "/api/activities": (200, activities ?? Self.activities),
            "/api/activities/a1": (200, Self.detail),
            "/api/world/basemap": (200, #"{"styleUrl":"https://example.test/style.json"}"#),
            "/api/quest-instances": (200, #"{"instances":[]}"#),
            "/api/skill-tree": (200, Self.skillTree),
            "/api/player/capabilities": (200, Self.capabilities),
            "/api/authored-quests": (200, #"{"quests":[]}"#)
        ]
        all.merge(overrides) { $1 }
        return all
    }

    private func loaded(_ responses: [String: (Int, String)], file: StaticString = #filePath, line: UInt = #line) async -> (HomeContent?, PathTransport) {
        let transport = PathTransport(responses)
        let model = HomeModel(api: APIClient(baseURL: baseURL, transport: transport))
        await model.load()
        guard case .loaded(let content) = model.state else {
            XCTFail("expected loaded, got \(model.state)", file: file, line: line)
            return (nil, transport)
        }
        return (content, transport)
    }

    func testLoadsAllHomeSections() async throws {
        let (loaded, _) = await loaded(responses())
        let content = try XCTUnwrap(loaded)
        XCTAssertEqual(content.progress.level, 5)
        XCTAssertEqual(content.lifetime.totalFlowlines, 11)
        XCTAssertEqual(content.latest?.revisitCount, 1)
        XCTAssertEqual(content.latest?.hasVideo, true)
        XCTAssertEqual(content.latestDetail?.events.map(\.collectible.name), ["Col du Pigeonnier"])
        XCTAssertEqual(content.replay?.route.count, 2)
        XCTAssertNotNil(content.basemap)
        let achievements = try XCTUnwrap(content.achievements)
        XCTAssertEqual(achievements.skillPoints, 5)
        XCTAssertEqual(achievements.unlockedSkills, 1)
        XCTAssertEqual(achievements.totalSkills, 2)
        XCTAssertEqual(achievements.earned.map(\.label), ["Climber"])
        XCTAssertEqual(content.todos, [.spendSkillPoints(5), .planExploration])
    }

    func testSecondaryFailuresStillRenderHome() async throws {
        let (loaded, _) = await loaded(responses(overrides: [
            "/api/skill-tree": (500, #"{"error":"boom"}"#),
            "/api/activities/a1": (500, #"{"error":"boom"}"#)
        ]))
        let content = try XCTUnwrap(loaded)
        XCTAssertNil(content.achievements)
        XCTAssertNil(content.latestDetail)
        XCTAssertNil(content.replay)
        XCTAssertEqual(content.latest?.id, "a1")
        XCTAssertEqual(content.todos, [.planExploration])
    }

    func testNoActivitiesSkipsDetailAndBasemap() async throws {
        let (loaded, transport) = await loaded(responses(activities: "[]"))
        let content = try XCTUnwrap(loaded)
        XCTAssertNil(content.latest)
        XCTAssertFalse(transport.paths.contains("/api/activities/a1"))
        XCTAssertFalse(transport.paths.contains("/api/world/basemap"))
    }

    func testRequiredFailureSurfacesError() async {
        let transport = PathTransport(responses(overrides: ["/api/player/progress-dashboard": (500, #"{"error":"boom"}"#)]))
        let model = HomeModel(api: APIClient(baseURL: baseURL, transport: transport))
        await model.load()
        XCTAssertEqual(model.state, .failed("boom"))
    }

    func testTodosOrderAndFallback() throws {
        func decode<T: Decodable>(_ json: String) throws -> T { try JSONDecoder().decode(T.self, from: Data(json.utf8)) }
        let active: AuthoredQuest = try decode(Self.authored("q1", state: "active"))
        let locked: AuthoredQuest = try decode(Self.authored("q3", state: "locked"))
        let completed: AuthoredQuest = try decode(Self.authored("q4", state: "completed"))
        let exploring: QuestInstance = try decode(Self.instance("x", status: "active"))
        let done: QuestInstance = try decode(Self.instance("y", status: "completed"))

        XCTAssertEqual(
            HomeTodo.list(skillPoints: 2, authoredQuests: [locked, active, completed], instances: [done, exploring]),
            [.spendSkillPoints(2), .quest(active), .exploration(exploring)]
        )
        XCTAssertEqual(HomeTodo.list(skillPoints: 0, authoredQuests: [active], instances: [done]), [.quest(active)])
        XCTAssertEqual(HomeTodo.list(skillPoints: 0, authoredQuests: [locked], instances: [exploring]), [.exploration(exploring)])
        XCTAssertEqual(HomeTodo.list(skillPoints: 0, authoredQuests: [locked, completed], instances: [done]), [.planExploration])
        XCTAssertEqual(HomeTodo.spendSkillPoints(2).target, .skillAtlas)
        XCTAssertEqual(HomeTodo.quest(active).target, .quests)
        XCTAssertEqual(HomeTodo.moreQuests(4).target, .quests)
        XCTAssertEqual(HomeTodo.exploration(exploring).target, .world)
        XCTAssertEqual(HomeTodo.planExploration.target, .world)
    }

    func testTodosCapActiveQuestsAtThree() throws {
        let quests: [AuthoredQuest] = try (1...4).map {
            try JSONDecoder().decode(AuthoredQuest.self, from: Data(Self.authored("q\($0)", state: "active").utf8))
        }
        let todos = HomeTodo.list(skillPoints: 0, authoredQuests: quests, instances: [])
        XCTAssertEqual(todos, [.quest(quests[0]), .quest(quests[1]), .quest(quests[2]), .moreQuests(4)])
        XCTAssertEqual(HomeTodo.list(skillPoints: 0, authoredQuests: Array(quests.prefix(3)), instances: []).count, 3)
    }
}
