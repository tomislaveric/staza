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

    func testRemovingOrMovingStopsReroutesOnceAfterAPause() async throws {
        let transport = StubTransport([
            .init(status: 200, body: #"{"explorationId":"e1","proposal":\#(proposal("p1"))}"#),
            .init(status: 200, body: #"{"explorationId":"e2","proposal":\#(proposal("p2"))}"#)
        ])
        let planner = RoutePlannerModel(api: APIClient(baseURL: baseURL, transport: transport), rerouteDelay: .milliseconds(100))
        planner.open(start: GeoPoint(lat: 48, lon: 11))
        let a = PlannerStop.collectible(collectible("a")), b = PlannerStop.collectible(collectible("b"))
        let c = PlannerStop.flowline(flowline("c"))
        [a, b, c].forEach(planner.toggle)
        planner.remove(c)
        try await Task.sleep(for: .milliseconds(250))
        XCTAssertTrue(transport.requests.isEmpty, "edits before the first route do not route")

        planner.toggle(c)
        await planner.route()
        XCTAssertEqual(planner.proposal?.id, "p1")
        planner.focus(c)
        XCTAssertEqual(planner.focusedStop?.key, c.key)
        planner.move(from: IndexSet(integer: planner.stops.count - 1), to: 0)
        planner.move(from: IndexSet(integer: 1), to: 0)
        planner.remove(c)
        XCTAssertNil(planner.focusedStopKey, "removing the focused stop clears the highlight")
        XCTAssertNil(planner.proposal)
        for _ in 0..<40 where planner.proposal == nil { try await Task.sleep(for: .milliseconds(25)) }
        XCTAssertEqual(planner.proposal?.id, "p2")
        XCTAssertEqual(transport.requests.count, 2, "quick edits trigger one recalculation")
        XCTAssertEqual(try json(transport.requests.last)["keepOrder"] as? Bool, true)
    }

    func testValidationAndLimits() async {
        let transport = StubTransport([])
        let planner = RoutePlannerModel(api: APIClient(baseURL: baseURL, transport: transport))
        planner.open(start: nil)
        XCTAssertNil(planner.mapMode, "start selection is deferred until requested")
        await planner.route()
        XCTAssertEqual(planner.failure, .missingStart)
        planner.toggleMapMode(.pickStart)
        planner.mapTapped(GeoPoint(lat: 48, lon: 11))
        XCTAssertEqual(planner.start, GeoPoint(lat: 48, lon: 11))
        await planner.route()
        XCTAssertEqual(planner.failure, .noStops)
        for id in ["1", "2", "3", "4", "5"] { planner.toggle(.flowline(flowline(id))) }
        XCTAssertEqual(planner.stops.count, 5)
        XCTAssertNil(planner.failure)
        planner.chooseShape(.pointToPoint)
        await planner.route()
        XCTAssertEqual(planner.failure, .missingEnd)
        XCTAssertTrue(transport.requests.isEmpty)
    }

    func testEmptyMapAddsWaypointUnlessEndpointPickIsActive() {
        let planner = RoutePlannerModel(api: APIClient(baseURL: baseURL, transport: StubTransport([])))
        let start = GeoPoint(lat: 48, lon: 11)
        let waypoint = GeoPoint(lat: 48.1, lon: 11.1)
        let end = GeoPoint(lat: 48.2, lon: 11.2)
        planner.open(start: start)

        XCTAssertFalse(planner.mapTapped(waypoint), "stops are edited once there is a route to edit")
        XCTAssertTrue(planner.stops.isEmpty)
        planner.toggle(.collectible(collectible("a")))
        planner.remove(.collectible(collectible("a")))
        planner.toggle(.waypoint(waypoint))
        XCTAssertTrue(planner.mapTapped(GeoPoint(lat: 48.3, lon: 11.3)))
        planner.remove(.waypoint(GeoPoint(lat: 48.3, lon: 11.3)))
        XCTAssertEqual(planner.stops.map(\.key), [PlannerStop.waypointKey(waypoint)])
        planner.chooseShape(.pointToPoint)
        XCTAssertNil(planner.mapMode, "an A→B route ends at the aim unless the player picks an end")
        planner.toggleMapMode(.pickEnd)
        XCTAssertTrue(planner.mapTapped(end))
        XCTAssertEqual(planner.end, end)
        XCTAssertEqual(planner.stops.map(\.key), [PlannerStop.waypointKey(waypoint)])
        XCTAssertNil(planner.mapMode)
    }

    func testMapFeatureTapsToggleStopsOnlyWhenNotPickingAnEndpoint() {
        let planner = RoutePlannerModel(api: APIClient(baseURL: baseURL, transport: StubTransport([])))
        planner.open(start: GeoPoint(lat: 48, lon: 11))
        let stop = PlannerStop.flowline(flowline("f1"))
        let target = PlannerStop.collectible(collectible("c1"))

        XCTAssertFalse(planner.mapSelected(stop), "no route to edit yet")
        planner.toggle(.waypoint(GeoPoint(lat: 48.3, lon: 11.3)))
        XCTAssertTrue(planner.mapSelected(stop))
        XCTAssertTrue(planner.contains(stop))
        XCTAssertTrue(planner.mapSelected(stop))
        XCTAssertFalse(planner.contains(stop))
        XCTAssertTrue(planner.mapSelected(target))
        XCTAssertTrue(planner.contains(target))

        planner.toggleMapMode(.pickEnd)
        XCTAssertFalse(planner.mapSelected(stop))
        planner.toggleMapMode(.pickStart)
        XCTAssertFalse(planner.mapSelected(target))
        XCTAssertTrue(planner.contains(target))
    }

    func testMissingStartDoesNotInterceptWaypointTapAndCanBePickedExplicitly() {
        let planner = RoutePlannerModel(api: APIClient(baseURL: baseURL, transport: StubTransport([])))
        planner.open(start: nil)
        let waypoint = GeoPoint(lat: 48.1, lon: 11.1)
        let start = GeoPoint(lat: 48.2, lon: 11.2)

        planner.toggle(.collectible(collectible("a")))
        XCTAssertTrue(planner.mapTapped(waypoint))
        XCTAssertNil(planner.start)
        XCTAssertEqual(planner.stops.map(\.key), ["a", PlannerStop.waypointKey(waypoint)])
        planner.toggleMapMode(.pickStart)
        XCTAssertTrue(planner.mapTapped(start))
        XCTAssertEqual(planner.start, start)
        XCTAssertEqual(planner.stops.map(\.key), ["a", PlannerStop.waypointKey(waypoint)])
    }

    private let aim = GeoPoint(lat: 48.25, lon: 11.25)

    /// A generate response with one baseline route and f1 as an optional enhancement.
    private func generated() -> String {
        let line = #""geometry":{"type":"LineString","coordinates":[[11.1,48.1],[11.2,48.2]]}"#
        let flowlines = #"[{"id":"f1","name":"Open",\#(line),"completed":false},{"id":"f2","name":"Done",\#(line),"completed":true},{"id":"f3","name":"Skipped",\#(line),"completed":false}]"#
        let catalog = #"{"collectibles":[{"id":"a","name":"A","latitude":48,"longitude":11,"found":false},{"id":"b","name":"B","latitude":48,"longitude":11,"found":false}],"flowlines":\#(flowlines)}"#
        let option = #"{"flowline":{"id":"f1","name":"Open",\#(line),"completed":false},"rationale":"A flow ride close to your route."}"#
        return #"{"explorationId":"e1","proposals":[\#(proposal("pc", targets: ["b"]))],"catalog":\#(catalog),"flowlineEnhancements":[\#(option)]}"#
    }

    func testWizardGeneratesOneRouteWithEditableStops() async throws {
        let transport = StubTransport([.init(status: 200, body: generated())])
        let planner = RoutePlannerModel(api: APIClient(baseURL: baseURL, transport: transport))
        planner.open(start: GeoPoint(lat: 48, lon: 11), destination: aim, destinationId: "b")
        XCTAssertTrue(planner.showsSteps)
        planner.chooseSport(.running)
        XCTAssertEqual(planner.generateRequest, 0, "the shape is still missing")
        planner.chooseShape(.roundTrip)
        XCTAssertEqual(planner.generateRequest, 1, "sport and shape start generation")
        XCTAssertFalse(planner.showsSteps, "done steps collapse into the summary")

        await planner.generate(toward: aim)
        let body = try json(transport.requests.first)
        XCTAssertEqual(transport.requests.first?.url?.path, "/api/explorations/generate")
        XCTAssertNil(body["intents"])
        XCTAssertEqual(body["sport"] as? String, "running")
        XCTAssertEqual(body["routeType"] as? String, "round_trip")
        XCTAssertNil(body["end"])
        XCTAssertNil(body["area"], "routes aim at a target instead of a map area")
        XCTAssertEqual((body["target"] as? [String: Double])?["lat"], 48.25)
        XCTAssertTrue(planner.generated)
        XCTAssertEqual(planner.proposal?.id, "pc", "the one route is shown right away")
        XCTAssertEqual(planner.stops.map(\.key), ["b"], "only the selected destination becomes a baseline stop")
        XCTAssertTrue(planner.canEditStops)
        XCTAssertFalse(planner.suggestReplacesOwnStops, "regenerating untouched stops needs no confirmation")
        planner.remove(planner.stops[0])
        planner.toggle(.collectible(collectible("a")))
        XCTAssertTrue(planner.suggestReplacesOwnStops, "an edited route is the player's own")

        planner.reopenSteps()
        XCTAssertTrue(planner.showsSteps)
        planner.chooseShape(.roundTrip)
        XCTAssertEqual(planner.generateRequest, 1, "an unchanged choice only collapses the steps")
        XCTAssertFalse(planner.showsSteps)
        planner.reopenSteps()
        planner.chooseSport(.hiking)
        XCTAssertEqual(planner.generateRequest, 1, "a new sport reroutes edited stops instead of replacing them")
        XCTAssertEqual(planner.stops.map(\.key), ["a"], "the player's edited stops stay")

        planner.close()
        XCTAssertFalse(planner.sportChosen, "the wizard starts over next time")
    }

    func testOptionalFlowlineEnhancementReroutesBaselineAndShowsActualDeltas() async throws {
        let enhanced = proposal("p2", extra: #","flowlineIds":["f1"]"#)
        let metrics = #"{"distanceDeltaM":1200,"durationDeltaS":300,"elevationGainDeltaM":80}"#
        let transport = StubTransport([
            .init(status: 200, body: generated()),
            .init(status: 200, body: #"{"proposal":\#(enhanced),"metrics":\#(metrics),"flowlineIds":["f1"]}"#)
        ])
        let planner = RoutePlannerModel(api: APIClient(baseURL: baseURL, transport: transport))
        planner.open(start: GeoPoint(lat: 48, lon: 11))
        planner.chooseSport(.cycling)
        planner.chooseShape(.roundTrip)
        await planner.generate(toward: aim)
        await planner.setFlowlineEnhancement("f1", enabled: true)

        XCTAssertEqual(planner.proposal?.id, "p2")
        XCTAssertEqual(planner.selectedEnhancementIds, ["f1"])
        XCTAssertEqual(planner.enhancementMetrics?.distanceDeltaM, 1200)
        XCTAssertEqual(transport.requests.last?.url?.path, "/api/explorations/e1/enhance")
        let body = try json(transport.requests.last)
        XCTAssertEqual(body["proposalId"] as? String, "pc", "every combination is compared with the baseline")
        XCTAssertEqual(body["flowlineIds"] as? [String], ["f1"])
    }

    func testAddingAStopToTheGeneratedRouteReroutes() async throws {
        let transport = StubTransport([
            .init(status: 200, body: generated()),
            .init(status: 200, body: #"{"explorationId":"e2","proposal":\#(proposal("p2"))}"#)
        ])
        let planner = RoutePlannerModel(api: APIClient(baseURL: baseURL, transport: transport), rerouteDelay: .milliseconds(50))
        planner.open(start: GeoPoint(lat: 48, lon: 11))
        XCTAssertFalse(planner.mapSelected(.flowline(flowline("f9"))), "no editing before a route exists")
        planner.chooseSport(.cycling)
        planner.chooseShape(.roundTrip)
        await planner.generate(toward: aim)
        XCTAssertTrue(planner.mapSelected(.flowline(flowline("f9"))))
        for _ in 0..<40 where planner.proposal?.id != "p2" { try await Task.sleep(for: .milliseconds(25)) }
        XCTAssertEqual(planner.proposal?.id, "p2")
        XCTAssertEqual(transport.requests.last?.url?.path, "/api/explorations/plan")
        XCTAssertTrue(planner.generated, "the edited route stays the generated one")
    }

    func testPointToPointEndsAtTheAim() async throws {
        let transport = StubTransport([.init(status: 200, body: generated())])
        let planner = RoutePlannerModel(api: APIClient(baseURL: baseURL, transport: transport))
        planner.open(start: GeoPoint(lat: 48, lon: 11))
        planner.chooseSport(.cycling)
        planner.chooseShape(.pointToPoint)
        XCTAssertNil(planner.mapMode, "no extra map tap for the end")
        XCTAssertEqual(planner.generateRequest, 1, "the aim is the end")
        await planner.generate(toward: aim)
        let body = try json(transport.requests.first)
        XCTAssertEqual(body["routeType"] as? String, "point_to_point")
        XCTAssertEqual((body["target"] as? [String: Double])?["lat"], aim.lat, "an A→B route ends at the aim")
        XCTAssertEqual(planner.end, aim)

        planner.reopenSteps()
        planner.chooseShape(.roundTrip)
        planner.reopenSteps()
        planner.chooseShape(.pointToPoint)
        XCTAssertNil(planner.end, "a new A→B route aims again")
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

    func testUnprocessableSuggestionReportsNoSuggestionInsteadOfUnconnectedStops() async {
        let planner = RoutePlannerModel(api: APIClient(baseURL: baseURL, transport: StubTransport([.init(status: 422, body: #"{"error":"x"}"#)])))
        planner.open(start: GeoPoint(lat: 48, lon: 11))
        await planner.generate(toward: aim)
        XCTAssertEqual(planner.failure, .noSuggestion)
        XCTAssertFalse(planner.generated)
        XCTAssertNil(planner.proposal)
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
