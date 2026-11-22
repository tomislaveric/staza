import XCTest
@testable import Staza

@MainActor
final class RoutePlannerModelTests: XCTestCase {
    private func flowline(_ id: String) -> WorldFlowline {
        WorldFlowline(id: id, name: "Flow \(id)", geometry: .init(coordinates: [[11.1, 48.1], [11.2, 48.2]]), completed: false)
    }

    private func collectible(_ id: String) -> WorldCollectible {
        WorldCollectible(id: id, name: id.uppercased(), latitude: 48.05, longitude: 11.05, found: false, primaryCategory: "peak")
    }

    private func proposal(_ id: String, targets: [String] = [], extra: String = "") -> String {
        #"{"id":"\#(id)","label":"balanced","recommended":true,"distanceM":40000,"durationS":7200,"geometry":{"type":"LineString","coordinates":[[11,48],[11.1,48.1]]},"start":{"lat":48,"lon":11},"includedTargetIds":[\#(targets.map { "\"\($0)\"" }.joined(separator: ","))]\#(extra)}"#
    }

    private func json(_ request: URLRequest?) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request?.httpBody)) as? [String: Any])
    }

    func testRouteSendsMixedStopsAndAdoptsStazaOrderUnlessReordered() async throws {
        let order = #","stopOrder":["waypoint:48.100000,11.300000","a","flowline:f1"]"#
        let transport = StubTransport([
            .init(status: 200, body: #"{"explorationId":"e1","proposal":\#(proposal("p1", extra: order))}"#),
            .init(status: 200, body: #"{"explorationId":"e2","proposal":\#(proposal("p2", extra: order))}"#)
        ])
        let planner = RoutePlannerModel(api: APIClient(baseURL: baseURL, transport: transport))
        planner.toggle(.flowline(flowline("f1")))
        planner.open(start: GeoPoint(lat: 48, lon: 11))
        XCTAssertEqual(planner.stops.map(\.key), ["flowline:f1"], "stops added before opening are kept")
        planner.toggle(.collectible(collectible("a")))
        planner.toggleMapMode(.addWaypoint)
        XCTAssertTrue(planner.mapTapped(GeoPoint(lat: 48.1, lon: 11.3)))

        await planner.route()
        XCTAssertEqual(planner.proposal?.id, "p1")
        XCTAssertEqual(planner.stops.map(\.key), ["waypoint:48.100000,11.300000", "a", "flowline:f1"])
        let body = try json(transport.requests.first)
        XCTAssertEqual(transport.requests.first?.url?.path, "/api/explorations/plan")
        XCTAssertEqual(body["keepOrder"] as? Bool, false)
        let stops = try XCTUnwrap(body["stops"] as? [[String: Any]])
        XCTAssertEqual(stops.first?["kind"] as? String, "flowline")
        XCTAssertEqual(stops.first?["id"] as? String, "f1")
        XCTAssertEqual(stops.last?["lat"] as? Double, 48.1)

        planner.move(from: IndexSet(integer: 2), to: 0)
        XCTAssertNil(planner.proposal, "every edit clears the routed result")
        XCTAssertTrue(planner.keepOrder)
        await planner.route()
        XCTAssertEqual(planner.stops.map(\.key), ["flowline:f1", "waypoint:48.100000,11.300000", "a"], "the player's order is kept")
        XCTAssertEqual(try json(transport.requests.last)["keepOrder"] as? Bool, true)
    }

    func testValidationAndLimits() async {
        let transport = StubTransport([])
        let planner = RoutePlannerModel(api: APIClient(baseURL: baseURL, transport: transport))
        planner.open(start: nil)
        XCTAssertEqual(planner.mapMode, .pickStart)
        await planner.route()
        XCTAssertEqual(planner.failure, .missingStart)
        planner.mapTapped(GeoPoint(lat: 48, lon: 11))
        XCTAssertEqual(planner.start, GeoPoint(lat: 48, lon: 11))
        await planner.route()
        XCTAssertEqual(planner.failure, .noStops)
        for id in ["1", "2", "3", "4", "5"] { planner.toggle(.flowline(flowline(id))) }
        XCTAssertEqual(planner.stops.count, 5)
        XCTAssertNil(planner.failure)
        planner.setRouteType(.pointToPoint)
        await planner.route()
        XCTAssertEqual(planner.failure, .missingEnd)
        XCTAssertTrue(transport.requests.isEmpty)
    }

    func testGenerateReplacesStopsWithTheRouteCollectiblesAndRiddenOpportunities() async throws {
        let line = #""geometry":{"type":"LineString","coordinates":[[11.1,48.1],[11.2,48.2]]}"#
        let flowlines = #"[{"id":"f1","name":"Open",\#(line),"completed":false},{"id":"f2","name":"Done",\#(line),"completed":true},{"id":"f3","name":"Skipped",\#(line),"completed":false}]"#
        let catalog = #"{"collectibles":[{"id":"a","name":"A","latitude":48,"longitude":11,"found":false},{"id":"b","name":"B","latitude":48,"longitude":11,"found":false}],"flowlines":\#(flowlines)}"#
        let traversed = #","traversedFlowlines":[{"id":"f1","name":"Open"},{"id":"f2","name":"Done"}]"#
        let transport = StubTransport([.init(status: 200, body: #"{"explorationId":"e1","proposals":[\#(proposal("p1", targets: ["b", "a"], extra: traversed))],"catalog":\#(catalog)}"#)])
        let planner = RoutePlannerModel(api: APIClient(baseURL: baseURL, transport: transport))
        planner.open(start: GeoPoint(lat: 48, lon: 11))
        planner.toggle(.waypoint(GeoPoint(lat: 48.2, lon: 11.2)))
        XCTAssertEqual(planner.intent, .chill, "Chill is the default feel")
        planner.intent = .flow
        await planner.suggest(in: WorldBounds(west: 11, south: 48, east: 11.5, north: 48.5)) { _ in nil }
        XCTAssertEqual(planner.stops.map(\.key), ["b", "a", "flowline:f1"])
        XCTAssertEqual(planner.proposal?.id, "p1")
        XCTAssertEqual(transport.requests.first?.url?.path, "/api/explorations/generate")
        let body = try json(transport.requests.first)
        XCTAssertNil(body["stops"])
        XCTAssertEqual(body["intent"] as? String, "flow")
        planner.close()
        XCTAssertEqual(planner.intent, .chill, "the feel is not kept beyond the session")
    }

    func testSaveStoresAPlannedExplorationAndClosesPlanner() async throws {
        let saved = #"{"instance":{"id":"q","title":"Ride","description":"","status":"planned","difficulty":"easy","rewardXp":10,"objectives":[]},"plannedRoute":{"questInstanceId":"q","distanceM":1,"durationS":1,"geometry":{"type":"LineString","coordinates":[[11,48],[11.1,48.1]]},"start":{"lat":48,"lon":11}}}"#
        let transport = StubTransport([
            .init(status: 200, body: #"{"explorationId":"e1","proposal":\#(proposal("p1"))}"#),
            .init(status: 200, body: saved)
        ])
        let planner = RoutePlannerModel(api: APIClient(baseURL: baseURL, transport: transport))
        planner.open(start: GeoPoint(lat: 48, lon: 11))
        planner.toggle(.collectible(collectible("a")))
        await planner.route()
        let didSave = await planner.save()
        XCTAssertTrue(didSave)
        XCTAssertEqual(transport.requests.last?.url?.path, "/api/explorations/save")
        XCTAssertEqual(try json(transport.requests.last)["proposalId"] as? String, "p1")
        XCTAssertFalse(planner.isActive)
        XCTAssertTrue(planner.stops.isEmpty)
        XCTAssertTrue(planner.displayedRoute.isEmpty, "a saved route is drawn with the saved routes, not as the planner's route")
        XCTAssertEqual(planner.status, .idle)
    }

    func testFailedSaveKeepsThePlannerOpen() async {
        let transport = StubTransport([
            .init(status: 200, body: #"{"explorationId":"e1","proposal":\#(proposal("p1"))}"#),
            .init(status: 500, body: #"{"error":"Boom"}"#)
        ])
        let planner = RoutePlannerModel(api: APIClient(baseURL: baseURL, transport: transport))
        planner.open(start: GeoPoint(lat: 48, lon: 11))
        planner.toggle(.collectible(collectible("a")))
        await planner.route()
        let didSave = await planner.save()
        XCTAssertFalse(didSave)
        XCTAssertTrue(planner.isActive)
        XCTAssertEqual(planner.proposal?.id, "p1")
        XCTAssertNotNil(planner.failure)
    }

    func testUnprocessableRouteReportsNoRoute() async {
        let planner = RoutePlannerModel(api: APIClient(baseURL: baseURL, transport: StubTransport([.init(status: 422, body: #"{"error":"x"}"#)])))
        planner.open(start: GeoPoint(lat: 48, lon: 11))
        planner.toggle(.collectible(collectible("a")))
        await planner.route()
        XCTAssertEqual(planner.failure, .noRoute)
        XCTAssertEqual(planner.status, .idle)
        XCTAssertNil(planner.proposal)
    }
}
