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
        XCTAssertEqual(planner.stops.count, 4)
        XCTAssertEqual(planner.failure, .limit(.flowline, 4))
        planner.setRouteType(.pointToPoint)
        await planner.route()
        XCTAssertEqual(planner.failure, .missingEnd)
        XCTAssertTrue(transport.requests.isEmpty)
    }

    func testSuggestReplacesStopsWithTheRecommendedCollectibles() async throws {
        let catalog = #"{"collectibles":[{"id":"a","name":"A","latitude":48,"longitude":11,"found":false},{"id":"b","name":"B","latitude":48,"longitude":11,"found":false}]}"#
        let transport = StubTransport([.init(status: 200, body: #"{"explorationId":"e1","proposals":[\#(proposal("p1", targets: ["b", "a"]))],"catalog":\#(catalog)}"#)])
        let planner = RoutePlannerModel(api: APIClient(baseURL: baseURL, transport: transport))
        planner.open(start: GeoPoint(lat: 48, lon: 11))
        planner.toggle(.waypoint(GeoPoint(lat: 48.2, lon: 11.2)))
        await planner.suggest(in: WorldBounds(west: 11, south: 48, east: 11.5, north: 48.5)) { _ in nil }
        XCTAssertEqual(planner.stops.map(\.key), ["b", "a"])
        XCTAssertEqual(planner.proposal?.id, "p1")
        XCTAssertEqual(transport.requests.first?.url?.path, "/api/explorations/generate")
        XCTAssertNil(try json(transport.requests.first)["stops"])
    }

    func testConfirmClosesPlannerAndKeepsPlannedRoute() async {
        let route = #"{"plannedRoute":{"questInstanceId":"q","distanceM":1,"durationS":1,"geometry":{"type":"LineString","coordinates":[[11,48],[11.1,48.1]]},"start":{"lat":48,"lon":11}}}"#
        let planner = RoutePlannerModel(api: APIClient(baseURL: baseURL, transport: StubTransport([
            .init(status: 200, body: #"{"explorationId":"e1","proposal":\#(proposal("p1"))}"#),
            .init(status: 200, body: route)
        ])))
        planner.open(start: GeoPoint(lat: 48, lon: 11))
        planner.toggle(.collectible(collectible("a")))
        await planner.route()
        let confirmed = await planner.confirm()
        XCTAssertTrue(confirmed)
        XCTAssertFalse(planner.isActive)
        XCTAssertTrue(planner.stops.isEmpty)
        XCTAssertEqual(planner.displayedRoute.count, 2)
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
