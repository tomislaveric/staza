import XCTest
@testable import Staza

@MainActor
final class ProgressDashboardModelTests: XCTestCase {
    private final class RecordingTransport: HTTPTransport, @unchecked Sendable {
        private let lock = NSLock()
        private var recorded: [String] = []
        var paths: [String] { lock.withLock { recorded } }
        let failSupplementary: Bool

        init(failSupplementary: Bool = false) { self.failSupplementary = failSupplementary }

        func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
            let path = request.url!.path
            lock.withLock { recorded.append("\(request.httpMethod ?? "GET") \(path)") }
            let (status, body): (Int, String)
            switch path {
            case "/api/player/progress-dashboard": (status, body) = (200, Self.dashboard)
            case "/api/rewards/new": (status, body) = (200, #"{"hasNew":false,"hasNewProgress":true}"#)
            case "/api/authored-quests": (status, body) = failSupplementary ? (500, "{}") : (200, Self.quests)
            case "/api/player/capabilities": (status, body) = failSupplementary ? (500, "{}") : (200, Self.capabilities)
            default: (status, body) = (204, "")
            }
            return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
        }

        static let dashboard = #"{"progress":{"totalXp":150,"level":2,"currentLevelXp":100,"nextLevelXp":300,"progressToNextLevel":0.25,"remainingXp":150,"progressPercent":25},"lifetime":{"distanceMeters":5000,"totalCollectibles":3,"totalFlowlines":1},"sportRecords":[{"type":"cycling","activityCount":2,"distanceMeters":5000,"longestDistanceMeters":3000}],"milestones":{"places":1,"peaks":1,"mountainPasses":0,"flowlines":1},"recentActivities":[{"id":"a1","type":"cycling","title":"Ride","startedAt":"2026-01-01T10:00:00.000Z","distanceMeters":3000,"durationSeconds":600,"xpEarned":50,"collectedCount":1,"revisitCount":0,"flowlineCount":0,"hasVideo":false,"xpPercentOfBest":100}]}"#

        static let quests = "{\"quests\":[" + [
            quest("a:1", state: "completed", extra: #","isNew":true"#),
            quest("a:2", state: "active", extra: #","lastFailure":{"attemptCount":1,"criteria":[{"label":"Ride 30 km","current":12,"required":30,"unit":"km","met":false}]}"#),
            quest("b:1", state: "locked", extra: #","requiredNode":{"id":"n","name":"Climber","premium":true}"#),
            quest("c:1", state: "active", extra: "")
        ].joined(separator: ",") + "]}"

        static let capabilities = #"{"titles":[{"id":"t","label":"Pathfinder"}],"badges":[{"id":"b","label":"Summit"}]}"#

        static func quest(_ id: String, state: String, extra: String) -> String {
            #"{"id":"\#(id)","chainTitle":"C","step":1,"totalSteps":2,"title":"T","description":"D","difficulty":"easy","xp":10,"state":"\#(state)"\#(extra)}"#
        }
    }

    func testLoadRendersDashboardAndMarksRewardsSeen() async {
        let transport = RecordingTransport()
        let model = ProgressDashboardModel(api: APIClient(baseURL: baseURL, transport: transport))
        await model.load()
        XCTAssertEqual(model.dashboard?.progress.level, 2)
        XCTAssertEqual(model.dashboard?.recentActivities.first?.activity.title, "Ride")
        XCTAssertTrue(model.showsNewRewards)
        XCTAssertEqual(transport.paths.last, "POST /api/rewards/seen")
    }

    func testLoadPartitionsQuestsAndCapabilities() async {
        let model = ProgressDashboardModel(api: APIClient(baseURL: baseURL, transport: RecordingTransport()))
        await model.load()
        XCTAssertEqual(model.activeQuests.map(\.id), ["a:2", "c:1"])
        XCTAssertEqual(model.lockedQuests.map(\.id), ["b:1"])
        XCTAssertEqual(model.finishedQuests.map(\.id), ["a:1"])
        XCTAssertEqual(model.capabilities?.badges.map(\.label), ["Summit"])
        XCTAssertEqual(model.capabilities?.titles.map(\.label), ["Pathfinder"])
    }

    func testSupplementaryFailuresKeepDashboard() async {
        let model = ProgressDashboardModel(api: APIClient(baseURL: baseURL, transport: RecordingTransport(failSupplementary: true)))
        await model.load()
        XCTAssertEqual(model.dashboard?.progress.level, 2)
        XCTAssertFalse(model.failed)
        XCTAssertTrue(model.activeQuests.isEmpty)
        XCTAssertNil(model.capabilities)
    }
}
