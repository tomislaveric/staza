import XCTest
@testable import Staza

@MainActor
final class ProgressDashboardModelTests: XCTestCase {
    private final class RecordingTransport: HTTPTransport, @unchecked Sendable {
        var paths: [String] = []
        func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
            let path = request.url!.path
            paths.append("\(request.httpMethod ?? "GET") \(path)")
            let (status, body): (Int, String)
            switch path {
            case "/api/player/progress-dashboard": (status, body) = (200, Self.dashboard)
            case "/api/rewards/new": (status, body) = (200, #"{"hasNew":false,"hasNewProgress":true}"#)
            default: (status, body) = (204, "")
            }
            return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
        }

        static let dashboard = #"{"progress":{"totalXp":150,"level":2,"currentLevelXp":100,"nextLevelXp":300,"progressToNextLevel":0.25,"remainingXp":150,"progressPercent":25},"lifetime":{"distanceMeters":5000,"totalCollectibles":3,"totalFlowlines":1},"sportRecords":[{"type":"cycling","activityCount":2,"distanceMeters":5000,"longestDistanceMeters":3000}],"milestones":{"places":1,"peaks":1,"mountainPasses":0,"flowlines":1},"recentActivities":[{"id":"a1","type":"cycling","title":"Ride","startedAt":"2026-01-01T10:00:00.000Z","distanceMeters":3000,"durationSeconds":600,"xpEarned":50,"collectedCount":1,"revisitCount":0,"flowlineCount":0,"hasVideo":false,"xpPercentOfBest":100}],"questHistory":[]}"#
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
}
