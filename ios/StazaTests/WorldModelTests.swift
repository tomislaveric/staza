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
}
