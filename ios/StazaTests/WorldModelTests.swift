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

    func testLoadsViewportCollectiblesButNoFlowlines() async {
        let model = WorldModel(api: APIClient(baseURL: baseURL, transport: PathTransport(responses: ["/api/world": (200, world)])))
        await model.loadViewport(WorldBounds(west: 7, south: 46, east: 9, north: 48))
        XCTAssertEqual(model.collectibles.map(\.id), ["c1"])
        XCTAssertFalse(model.viewportFailed)
    }

    func testLoadsSavedExplorationRoutesAndToleratesTheirAbsence() async {
        let route = #"{"id":"q1","title":"Ride","status":"active","geometry":{"type":"LineString","coordinates":[[8.0,47.0],[8.1,47.1]]}}"#
        let body = world.replacingOccurrences(of: #""truncated":false"#, with: #""truncated":false,"explorationRoutes":[\#(route)]"#)
        let transport = StubTransport([.init(status: 200, body: body), .init(status: 200, body: world)])
        let model = WorldModel(api: APIClient(baseURL: baseURL, transport: transport))
        let bounds = WorldBounds(west: 7, south: 46, east: 9, north: 48)
        await model.loadViewport(bounds)
        XCTAssertEqual(model.explorationRoutes.map(\.id), ["q1"])
        XCTAssertEqual(model.explorationRoutes.first?.geometry.clCoordinates.count, 2)
        await model.loadViewport(bounds)
        XCTAssertTrue(model.explorationRoutes.isEmpty)
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

    func testHidesHiddenCollectiblesAndResolvesById() async {
        let body = world.replacingOccurrences(of: #""primaryCategory":"peak"}"#, with: #""primaryCategory":"peak"},{"id":"c9","name":"Secret","latitude":47,"longitude":8,"found":false,"visibility":"hidden"}"#)
        let model = WorldModel(api: APIClient(baseURL: baseURL, transport: PathTransport(responses: ["/api/world": (200, body)])))
        await model.loadViewport(WorldBounds(west: 7, south: 46, east: 9, north: 48))
        XCTAssertEqual(model.collectibles.map(\.id), ["c1"], "hidden POIs stay off the map")
        XCTAssertEqual(model.collectible(id: "c1")?.name, "Peak")
        XCTAssertNil(model.collectible(id: "missing"))
    }

    private let instances = #"{"instances":[{"id":"q1","title":"Ride","description":"","status":"active","difficulty":"easy","rewardXp":10,"objectives":[{"progress":{"completed":1,"required":2,"complete":false},"objective":{"type":"collectible_targets","targets":[{"id":"c1"},{"id":"c2"}]}}]},{"id":"q2","title":"Saved","description":"","status":"active","difficulty":"easy","rewardXp":10,"objectives":[]}]}"#
    private let plannedRoute = #"{"questInstanceId":"q2","distanceM":1000,"durationS":300,"geometry":{"type":"LineString","coordinates":[[8.0,47.0],[8.1,47.1]]},"start":{"lat":47,"lon":8}}"#

    func testLoadsExplorationsAndTogglesTheShownRoute() async {
        let model = WorldModel(api: APIClient(baseURL: baseURL, transport: PathTransport(responses: [
            "/api/quest-instances": (200, instances),
            "/api/quest-instances/q2/planned-route": (200, plannedRoute)
        ])))
        await model.loadExplorations()
        XCTAssertEqual(model.instances.map(\.id), ["q1", "q2"])
        XCTAssertEqual(model.instances.first?.targetProgress.total, 2)
        XCTAssertEqual(Set(model.plannedRoutes.keys), ["q2"], "missing planned routes are skipped")

        model.highlight("q2")
        XCTAssertEqual(model.highlightedRoute?.questInstanceId, "q2")
        model.highlight("q2")
        XCTAssertNil(model.highlightedRoute)
    }

    func testDeleteCallsEndpointThenReloads() async {
        let route = #"{"id":"q2","title":"Saved","status":"active","geometry":{"type":"LineString","coordinates":[[8.0,47.0],[8.1,47.1]]}}"#
        let body = world.replacingOccurrences(of: #""truncated":false"#, with: #""truncated":false,"explorationRoutes":[\#(route)]"#)
        let transport = StubTransport([
            .init(status: 200, body: body),
            .init(status: 204, body: ""), .init(status: 200, body: instances),
            .init(status: 404, body: "{}"), .init(status: 404, body: "{}")
        ])
        let model = WorldModel(api: APIClient(baseURL: baseURL, transport: transport))
        await model.loadViewport(WorldBounds(west: 7, south: 46, east: 9, north: 48))
        XCTAssertEqual(model.explorationRoutes.map(\.id), ["q2"])

        let deleted = await model.delete("q2")
        XCTAssertTrue(deleted)
        XCTAssertEqual(transport.requests[1].httpMethod, "DELETE")
        XCTAssertEqual(transport.requests[1].url?.path, "/api/quest-instances/q2")
        XCTAssertTrue(model.explorationRoutes.isEmpty, "a deleted exploration leaves the map")
        XCTAssertEqual(model.instances.count, 2)
        XCTAssertNil(model.pendingInstanceId)
    }

    func testFailedDeleteIsReported() async {
        let model = WorldModel(api: APIClient(baseURL: baseURL, transport: StubTransport([.init(status: 500, body: "{}")])))
        let deleted = await model.delete("q1")
        XCTAssertFalse(deleted)
        XCTAssertTrue(model.instanceActionFailed)
    }
}
