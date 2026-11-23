import CoreLocation
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

    func testLoadsSavedExplorationRoutesAndToleratesTheirAbsence() async {
        let route = #"{"id":"q1","title":"Ride","status":"planned","geometry":{"type":"LineString","coordinates":[[8.0,47.0],[8.1,47.1]]}}"#
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

    func testExploreSessionShowsOpportunitiesUntilItEnds() async throws {
        let body = world.replacingOccurrences(of: #""truncated":false"#, with: #""truncated":false,"exploreAllowed":true"#)
            .replacingOccurrences(of: #""completed":false"#, with: #""completed":true"#)
        let line = #""geometry":{"type":"LineString","coordinates":[[8.0,47.0],[8.1,47.1]]},"completed":false"#
        let opportunity = #"{"id":"f2","name":"Rheintal",\#(line),"flowScore":84,"roadQualityScore":91,"character":{"primary":"flow","tags":["flow","explore"]}}"#
        let collectible = #"{"id":"c9","name":"Tower","latitude":47.05,"longitude":8.05,"found":false,"primaryCategory":"viewpoint"}"#
        let explored = #"{"outcome":"discovered","flowlines":[\#(opportunity)],"collectibles":[\#(collectible)],"collectiblesTruncated":false,"availableCount":0,"summary":{"total":1,"byCharacter":{"flow":1,"endurance":0,"explore":0},"collectibles":1}}"#
        let transport = StubTransport([.init(status: 200, body: body), .init(status: 200, body: explored), .init(status: 200, body: body)])
        let model = WorldModel(api: APIClient(baseURL: baseURL, transport: transport))
        let bounds = WorldBounds(west: 7, south: 46, east: 9, north: 48)
        await model.loadViewport(bounds)
        XCTAssertEqual(model.flowlines.map(\.id), ["f1"], "the map starts with the persistent world only")

        await model.exploreArea(reduceMotion: true)
        XCTAssertEqual(transport.requests.last?.url?.path, "/api/world/explore")
        let sent = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(transport.requests.last?.httpBody)) as? [String: Any])
        XCTAssertEqual(sent["bbox"] as? String, bounds.queryValue)
        XCTAssertEqual(model.visibleFlowlines.map(\.id), ["f1", "f2"])
        XCTAssertEqual(model.collectibles.map(\.id), ["c1", "c9"])
        XCTAssertEqual(model.sessionFlowlines.map(\.id), ["f2"])
        XCTAssertEqual(model.sessionBounds, bounds, "older servers explore the requested viewport")
        XCTAssertTrue(model.exploreOutline.isEmpty)
        XCTAssertEqual(model.flowline(id: "f2")?.resolvedCharacter.tags, [.flow, .explore])
        guard case .result(let result) = model.exploreState else { return XCTFail("expected a result") }
        XCTAssertEqual(result.breakdown, [ExploreResult.Count(tag: .flow, count: 1)])
        XCTAssertEqual(result.summary.collectibles, 1)

        await model.loadViewport(bounds)
        XCTAssertEqual(model.flowlines.map(\.id), ["f1", "f2"], "opportunities stay while the session is open")
        model.dismissExplore()
        XCTAssertNil(model.exploreState)
        XCTAssertTrue(model.hasExploreSession, "hiding the card keeps the session, e.g. for the planner")

        model.endExploreSession()
        XCTAssertEqual(model.flowlines.map(\.id), ["f1"])
        XCTAssertEqual(model.collectibles.map(\.id), ["c1"])
        XCTAssertFalse(model.hasExploreSession)
    }

    func testExploreResultToleratesUnknownOutcome() throws {
        let json = #"{"outcome":"something_new","flowlines":[],"collectibles":[],"collectiblesTruncated":false,"availableCount":3,"summary":{"total":0,"byCharacter":{}}}"#
        let result = try JSONDecoder().decode(ExploreResult.self, from: Data(json.utf8))
        XCTAssertEqual(result.outcome, .discovered)
        XCTAssertNil(result.summary.collectibles)
        let nothing = try JSONDecoder().decode(ExploreResult.self, from: Data(json.replacingOccurrences(of: "something_new", with: "nothing_new").utf8))
        XCTAssertEqual(nothing.outcome, .nothingNew)
    }

    func testWideViewportExploresTheClampedFrame() async {
        let explored = #"{"outcome":"nothing_new","flowlines":[],"collectibles":[],"availableCount":0,"summary":{"total":0,"byCharacter":{}},"area":{"bbox":"7.700000,46.550000,8.300000,47.450000","center":{"lat":47,"lon":8},"clamped":true}}"#
        let transport = StubTransport([.init(status: 200, body: world), .init(status: 200, body: explored), .init(status: 200, body: world)])
        let model = WorldModel(api: APIClient(baseURL: baseURL, transport: transport))
        await model.loadViewport(WorldBounds(west: 5, south: 45, east: 11, north: 49))
        await model.exploreArea(reduceMotion: true)
        let frame = WorldBounds(west: 7.7, south: 46.55, east: 8.3, north: 47.45)
        XCTAssertEqual(model.sessionBounds, frame, "Generate stays inside the explored frame")
        XCTAssertTrue(model.exploreClamped)
        XCTAssertEqual(model.exploreOutline.count, 5, "the clamped frame is outlined")
        XCTAssertTrue(frame.contains(GeoPoint(lat: 47, lon: 8)))
        XCTAssertFalse(frame.contains(GeoPoint(lat: 48, lon: 8)))
        model.endExploreSession()
        XCTAssertTrue(model.exploreOutline.isEmpty)
        XCTAssertFalse(model.exploreClamped)
    }

    func testExploresTheVisibleCircleAndOutlinesIt() async throws {
        let explored = #"{"outcome":"nothing_new","flowlines":[],"collectibles":[],"availableCount":0,"summary":{"total":0,"byCharacter":{}},"area":{"bbox":"7.986742,46.991015,8.013258,47.008985","center":{"lat":47,"lon":8},"clamped":false,"circle":{"center":{"lat":47,"lon":8},"radiusMeters":1000}}}"#
        let transport = StubTransport([.init(status: 200, body: world), .init(status: 200, body: explored), .init(status: 200, body: world)])
        let model = WorldModel(api: APIClient(baseURL: baseURL, transport: transport))
        await model.loadViewport(WorldBounds(west: 7.9, south: 46.9, east: 8.1, north: 47.1))
        let circle = ExploreCircle(center: GeoPoint(lat: 47, lon: 8), radiusMeters: 1000)
        model.exploreCircle = circle
        await model.exploreArea(reduceMotion: true)

        let sent = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(transport.requests.last?.httpBody)) as? [String: Any])
        let sentCircle = try XCTUnwrap(sent["circle"] as? [String: Any])
        XCTAssertEqual(sentCircle["radiusMeters"] as? Double, 1000)
        XCTAssertEqual(sent["bbox"] as? String, circle.bounds.queryValue, "older servers explore the circle's square")
        XCTAssertFalse(model.exploreClamped)
        let outline = model.exploreOutline
        XCTAssertGreaterThan(outline.count, 32)
        for point in outline {
            let meters = CLLocation(latitude: 47, longitude: 8).distance(from: CLLocation(latitude: point.latitude, longitude: point.longitude))
            XCTAssertEqual(meters, 1000, accuracy: 10)
        }
    }

    func testDiscoveryListOrdersAndFilters() {
        func flowline(_ id: String, flow: Double, endurance: Double) -> WorldFlowline {
            let primary: FlowlineTag = flow >= endurance ? .flow : .endurance
            return WorldFlowline(id: id, name: id, geometry: .init(coordinates: [[8, 47], [8, 47.01]]), completed: false,
                                 flowScore: flow, enduranceScore: endurance, character: FlowlineCharacter(primary: primary, tags: [primary]))
        }
        func collectible(_ id: String, _ category: String, hidden: Bool = false) -> WorldCollectible {
            WorldCollectible(id: id, name: id, latitude: 47, longitude: 8, found: false, primaryCategory: category,
                             visibility: hidden ? "hidden" : nil)
        }
        let flowlines = [flowline("a", flow: 60, endurance: 10), flowline("b", flow: 90, endurance: 10), flowline("c", flow: 10, endurance: 95)]
        let collectibles = [collectible("z", "castle"), collectible("y", "viewpoint"), collectible("x", "castle"), collectible("h", "peak", hidden: true)]
        let ids = { (filters: Set<DiscoveryFilter>) in
            DiscoveryItem.list(flowlines: flowlines, collectibles: collectibles, filters: filters).map(\.id)
        }
        XCTAssertEqual(ids([]), ["flowline:c", "flowline:b", "flowline:a", "collectible:x", "collectible:z", "collectible:y"])
        XCTAssertEqual(ids([.character(.flow)]), ["flowline:b", "flowline:a"])
        XCTAssertEqual(ids([.collectibles, .character(.endurance)]), ["flowline:c", "collectible:x", "collectible:z", "collectible:y"])
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

    private let instances = #"{"instances":[{"id":"q1","title":"Ride","description":"","status":"active","difficulty":"easy","rewardXp":10,"objectives":[{"progress":{"completed":1,"required":2,"complete":false},"objective":{"type":"collectible_targets","targets":[{"id":"c1"},{"id":"c2"}]}}]},{"id":"q2","title":"Saved","description":"","status":"planned","difficulty":"easy","rewardXp":10,"objectives":[]},{"id":"q3","title":"Half","description":"","status":"partially_completed","startedAt":"2026-11-01T08:00:00.000Z","difficulty":"easy","rewardXp":10,"objectives":[]}]}"#
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
        XCTAssertEqual(model.instances.map(\.status), ["active", "planned", "partially_completed"])
        XCTAssertTrue(model.instances[1].isPlanned)
        XCTAssertNil(model.instances[1].startedAt)
        XCTAssertEqual(model.instances[2].startedAt, "2026-11-01T08:00:00.000Z")
        XCTAssertTrue(model.mapQuestTargets.collectibles.isEmpty, "unvisited targets only show for the selected exploration")
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

    func testStartAndDeleteCallEndpointsThenReload() async {
        let route = #"{"id":"q2","title":"Saved","status":"planned","geometry":{"type":"LineString","coordinates":[[8.0,47.0],[8.1,47.1]]}}"#
        let body = world.replacingOccurrences(of: #""truncated":false"#, with: #""truncated":false,"explorationRoutes":[\#(route)]"#)
        let started = #"{"instance":{"id":"q2","title":"Saved","description":"","status":"active","startedAt":"2026-11-20T10:00:00.000Z","difficulty":"easy","rewardXp":10,"objectives":[]}}"#
        let transport = StubTransport([
            .init(status: 200, body: body),
            .init(status: 200, body: started), .init(status: 200, body: instances), .init(status: 200, body: targets),
            .init(status: 204, body: ""), .init(status: 200, body: instances), .init(status: 200, body: targets)
        ])
        let model = WorldModel(api: APIClient(baseURL: baseURL, transport: transport))
        await model.loadViewport(WorldBounds(west: 7, south: 46, east: 9, north: 48))
        let didStart = await model.start("q2")
        XCTAssertTrue(didStart)
        XCTAssertEqual(transport.requests[1].httpMethod, "POST")
        XCTAssertEqual(transport.requests[1].url?.path, "/api/quest-instances/q2/start")
        XCTAssertEqual(model.explorationRoutes.map(\.id), ["q2"])

        let deleted = await model.delete("q2")
        XCTAssertTrue(deleted)
        XCTAssertEqual(transport.requests[4].httpMethod, "DELETE")
        XCTAssertEqual(transport.requests[4].url?.path, "/api/quest-instances/q2")
        XCTAssertTrue(model.explorationRoutes.isEmpty, "a deleted exploration leaves the map")
        XCTAssertEqual(model.instances.count, 3)
        XCTAssertNil(model.pendingInstanceId)
    }

    func testFailedDeleteIsReported() async {
        let model = WorldModel(api: APIClient(baseURL: baseURL, transport: StubTransport([.init(status: 500, body: "{}")])))
        let deleted = await model.delete("q1")
        XCTAssertFalse(deleted)
        XCTAssertTrue(model.instanceActionFailed)
    }
}
