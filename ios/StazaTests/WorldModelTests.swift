import XCTest
@testable import Staza

@MainActor
final class WorldModelTests: XCTestCase {
    private struct PathTransport: HTTPTransport {
        let responses: [String: (Int, String)]
        func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
            let (status, body) = responses[request.url!.path] ?? (404, "{}")
            return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
        }
    }

    private let world = #"{"collectibles":[{"id":"c1","name":"Peak","latitude":47.1,"longitude":8.2,"found":true,"primaryCategory":"peak"}],"fartleks":[{"id":"f1","name":"Flow","geometry":{"type":"LineString","coordinates":[[8.0,47.0],[8.1,47.1]]},"completed":false}],"truncated":false}"#

    func testLoadsViewportCollectiblesAndFlowlines() async {
        let model = WorldModel(api: APIClient(baseURL: baseURL, transport: PathTransport(responses: ["/api/world": (200, world)])))
        await model.loadViewport(WorldBounds(west: 7, south: 46, east: 9, north: 48))
        XCTAssertEqual(model.collectibles.map(\.id), ["c1"])
        XCTAssertEqual(model.flowlines.first?.coordinates.count, 2)
        XCTAssertFalse(model.viewportFailed)
    }

    func testViewportFailureFlagged() async {
        let model = WorldModel(api: APIClient(baseURL: baseURL, transport: PathTransport(responses: [:])))
        await model.loadViewport(WorldBounds(west: 7, south: 46, east: 9, north: 48))
        XCTAssertTrue(model.viewportFailed)
    }

    func testStaleViewportResponseDoesNotOverwriteNewerOne() async {
        let newer = world.replacingOccurrences(of: #""id":"c1""#, with: #""id":"c2""#)
        let older = WorldBounds(west: 7, south: 46, east: 9, north: 48)
        let transport = GatedTransport(
            gate: { $0.url?.query?.contains(older.queryValue) == true },
            [.init(status: 200, body: newer), .init(status: 200, body: world)]
        )
        let model = WorldModel(api: APIClient(baseURL: baseURL, transport: transport))
        let slow = Task { await model.loadViewport(older) }
        while !transport.isHolding { await Task.yield() }
        await model.loadViewport(WorldBounds(west: 10, south: 46, east: 12, north: 48))
        transport.open()
        await slow.value
        XCTAssertEqual(model.collectibles.map(\.id), ["c2"])
    }

    func testBoundsClampedToValidRange() {
        XCTAssertEqual(WorldBounds(west: -200, south: -95, east: 200, north: 95).queryValue, "-180.00000,-90.00000,180.00000,90.00000")
    }

    func testSelectResolvesCollectibleById() async {
        let model = WorldModel(api: APIClient(baseURL: baseURL, transport: PathTransport(responses: ["/api/world": (200, world)])))
        await model.loadViewport(WorldBounds(west: 7, south: 46, east: 9, north: 48))
        model.select(.collectible, id: "c1")
        XCTAssertEqual(model.selection?.id, "collectible:c1")
        model.select(.flowline, id: "f1")
        XCTAssertEqual(model.selection?.id, "flowline:f1")
        model.select(.collectible, id: "missing")
        XCTAssertEqual(model.selection?.id, "flowline:f1")
    }

    private let instances = #"{"instances":[{"id":"q1","title":"Ride","description":"","status":"active","difficulty":"easy","rewardXp":10,"objectives":[{"progress":{"completed":1,"required":2,"complete":false},"objective":{"type":"collectible_targets","targets":[{"id":"c1"},{"id":"c2"}]}}]},{"id":"q2","title":"Old","description":"","status":"failed","difficulty":"easy","rewardXp":10,"objectives":[]}]}"#
    private let targets = #"{"collectibles":[{"id":"c1","name":"Peak","latitude":47.1,"longitude":8.2,"found":false}],"flowlines":[]}"#

    func testCapabilitiesSplitGrantedAndLockedFilters() async {
        let body = #"{"worldFilters":["high-flow"],"titles":[],"badges":[],"lockedWorldFilters":[{"id":"high-flow","nodeId":"n0","nodeName":"Flow"},{"id":"peaks-only","nodeId":"n1","nodeName":"Summiteer"},{"id":"segment-x","nodeId":"n2","nodeName":"Other"}]}"#
        let model = WorldModel(api: APIClient(baseURL: baseURL, transport: StubTransport([.init(status: 200, body: body)])))
        model.selectedFilters = [.highFlow, .longEndurance, .found]
        await model.loadCapabilities()
        XCTAssertEqual(model.capabilities.worldFilters, ["high-flow"])
        XCTAssertEqual(model.lockedFilters.map(\.filter), [.peaksOnly])
        XCTAssertEqual(model.lockedFilters.first?.nodeName, "Summiteer")
        XCTAssertEqual(model.selectedFilters, [.highFlow, .found])
    }

    func testHighlightLoadsInstanceTargetsAndTogglesOff() async {
        let transport = StubTransport([.init(status: 200, body: instances), .init(status: 200, body: targets), .init(status: 200, body: targets)])
        let model = WorldModel(api: APIClient(baseURL: baseURL, transport: transport))
        await model.loadQuestTargets()
        XCTAssertEqual(model.activeInstanceIds, ["q1"])
        XCTAssertEqual(model.instances.first?.targetProgress.completed, 1)
        XCTAssertEqual(model.instances.first?.targetProgress.total, 2)

        await model.highlight("q1")
        XCTAssertEqual(model.highlightedInstanceId, "q1")
        XCTAssertEqual(model.mapQuestTargets.collectibles.map(\.id), ["c1"])
        XCTAssertEqual(transport.requests.last?.url?.query, "collectibleId=c1&collectibleId=c2")

        await model.highlight("q1")
        XCTAssertNil(model.highlightedInstanceId)
        XCTAssertNil(model.highlightedTargets)
    }

    func testCancelAndRetryCallEndpointsThenReload() async {
        let transport = StubTransport([
            .init(status: 204, body: ""), .init(status: 200, body: instances), .init(status: 200, body: targets),
            .init(status: 204, body: ""), .init(status: 200, body: instances), .init(status: 200, body: targets)
        ])
        let model = WorldModel(api: APIClient(baseURL: baseURL, transport: transport))
        let cancelled = await model.cancel("q1")
        let retried = await model.retry("q2")
        XCTAssertTrue(cancelled && retried)
        XCTAssertEqual(transport.requests[0].httpMethod, "DELETE")
        XCTAssertEqual(transport.requests[0].url?.path, "/api/quest-instances/q1")
        XCTAssertEqual(transport.requests[3].httpMethod, "POST")
        XCTAssertEqual(transport.requests[3].url?.path, "/api/quest-instances/q2/retry")
        XCTAssertEqual(model.instances.count, 2)
        XCTAssertNil(model.pendingInstanceId)
    }

    func testFailedCancelIsReported() async {
        let model = WorldModel(api: APIClient(baseURL: baseURL, transport: StubTransport([.init(status: 500, body: "{}")])))
        let cancelled = await model.cancel("q1")
        XCTAssertFalse(cancelled)
        XCTAssertTrue(model.instanceActionFailed)
    }
}
