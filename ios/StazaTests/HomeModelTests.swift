import XCTest
@testable import Staza

@MainActor
final class HomeModelTests: XCTestCase {
    private static let dashboard = #"{"progress":{"totalXp":1075,"level":5,"currentLevelXp":75,"nextLevelXp":500,"progressToNextLevel":0.15,"remainingXp":425,"progressPercent":15},"lifetime":{"distanceMeters":137300,"totalCollectibles":2,"totalFlowlines":11},"sportRecords":[],"milestones":{"places":0,"peaks":0,"mountainPasses":0,"flowlines":11},"recentActivities":[],"questHistory":[]}"#
    private static let activities = #"[{"id":"a1","type":"cycling","title":"Ride","startedAt":"2026-11-08T10:00:00.000Z","distanceMeters":137300,"durationSeconds":20760,"xpEarned":1075,"collectedCount":2,"revisitCount":1,"flowlineCount":11,"hasVideo":true}]"#
    private static let detail = #"{"id":"a1","type":"cycling","title":"Ride","startedAt":"2026-11-08T10:00:00.000Z","distanceMeters":137300,"durationSeconds":20760,"xpEarned":1075,"collectedCount":2,"revisitCount":1,"flowlineCount":11,"hasVideo":true,"events":[{"id":"e1","collectible":{"name":"Col du Pigeonnier","type":"mountain_pass"},"value":100,"latitude":49.0,"longitude":7.9,"activityTimestamp":1500}],"replay":{"activity":{"route":[{"latitude":49.0,"longitude":7.9,"timestampMs":1000},{"latitude":49.1,"longitude":8.0,"timestampMs":2000}]},"activityResult":{"nearMisses":[]}}}"#
    private static let skillTree = #"{"isPremium":false,"earnedPoints":5,"spentPoints":0,"balance":5,"nextSkillPoint":{"level":6,"xpRemaining":425,"progress":0.15},"nodes":[\#(node("n1", "unlocked")),\#(node("n2", "locked")),\#(node("n3", "unlockable"))]}"#
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
        XCTAssertEqual(achievements.totalSkills, 3)
        XCTAssertEqual(achievements.earned.map(\.label), ["Climber"])
        let highlights = content.highlights
        XCTAssertNil(highlights.quest)
        XCTAssertEqual(highlights.skillPoints, 5)
        XCTAssertEqual(highlights.ready.map(\.id), ["n3"])
        XCTAssertTrue(highlights.showsSkills)
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
        XCTAssertNil(content.highlights.quest)
        XCTAssertFalse(content.highlights.showsSkills)
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

    private func decode<T: Decodable>(_ json: String) throws -> T { try JSONDecoder().decode(T.self, from: Data(json.utf8)) }

    private func quest(_ id: String, state: String = "active", difficulty: String = "medium", xp: Double = 100) throws -> AuthoredQuest {
        try decode(#"{"id":"\#(id)","chainTitle":"Chain","step":1,"totalSteps":3,"title":"Quest \#(id)","description":"D","difficulty":"\#(difficulty)","xp":\#(xp),"state":"\#(state)"}"#)
    }

    private func skill(
        _ id: String,
        state: SkillAtlasView_.Node.State = .locked,
        cost: Int = 1,
        prerequisitesMet: Bool = true,
        requirements: [(Double, Double)] = []
    ) -> SkillAtlasView_.Node {
        SkillAtlasView_.Node(
            id: id, name: id, description: "", sport: "cycling", branch: "rush", tier: .level(1), cost: cost,
            premium: false, grant: .init(type: "quest_unlock", label: id), prerequisites: [],
            layout: .init(col: 0, row: 0), state: state,
            requirements: requirements.map { .init(label: "Flowlines", target: $0.1, current: $0.0, met: $0.0 >= $0.1) },
            prerequisitesMet: prerequisitesMet
        )
    }

    func testFeaturesTheEasiestActiveQuest() throws {
        let quests = [
            try quest("hard", difficulty: "hard", xp: 50),
            try quest("medium-rich", xp: 300),
            try quest("done", state: "completed", difficulty: "easy"),
            try quest("medium-a"),
            try quest("medium-b")
        ]
        XCTAssertEqual(HomeHighlights.featuredQuest(quests)?.id, "medium-a")
        XCTAssertEqual(HomeHighlights.featuredQuest([try quest("m"), try quest("e", difficulty: "easy", xp: 400)])?.id, "e")
        XCTAssertNil(HomeHighlights.featuredQuest([try quest("x", state: "locked")]))
    }

    func testUpNextCountsActiveQuestsAndFindsTheExploration() throws {
        let exploring: QuestInstance = try decode(Self.instance("x", status: "active"))
        let done: QuestInstance = try decode(Self.instance("y", status: "completed"))
        let highlights = HomeHighlights(
            skillPoints: 0,
            authoredQuests: [try quest("1"), try quest("2", difficulty: "easy"), try quest("3", state: "locked")],
            instances: [done, exploring],
            nodes: []
        )
        XCTAssertEqual(highlights.quest?.id, "2")
        XCTAssertEqual(highlights.activeQuestCount, 2)
        XCTAssertEqual(highlights.exploration?.id, "x")
        XCTAssertFalse(highlights.showsSkills)
    }

    func testReadyNodesAreCheapestFirstAndCapped() {
        let nodes = [skill("a", state: .unlockable, cost: 3), skill("b", state: .unlockable), skill("c"), skill("d", state: .unlockable, cost: 2), skill("e", state: .unlockable, cost: 3)]
        XCTAssertEqual(HomeHighlights.readyNodes(nodes).map(\.id), ["b", "d", "a"])
    }

    func testAlmostNodesRankStartedLockedNodesByProgress() {
        let nodes = [
            skill("half", requirements: [(5, 10)]),
            skill("untouched", requirements: [(0, 10)]),
            skill("blocked", prerequisitesMet: false, requirements: [(9, 10)]),
            skill("premium", state: .premiumLocked, requirements: [(9, 10)]),
            skill("needs-sp", cost: 3, requirements: [(12, 10)]),
            skill("mixed", requirements: [(30, 10), (1, 10)])
        ]
        let almost = HomeHighlights.almostNodes(nodes)
        XCTAssertEqual(almost.map(\.id), ["needs-sp", "mixed", "half"])
        zip(almost.map(\.progress), [1, 0.55, 0.5]).forEach { XCTAssertEqual($0, $1, accuracy: 0.0001) }
        XCTAssertNil(almost[0].blockingRequirement)
        XCTAssertEqual(almost[1].blockingRequirement?.current, 1)
        XCTAssertEqual(HomeHighlights.requirementProgress(skill("free")), 1)
    }
}
