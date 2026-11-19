import XCTest
@testable import Staza

@MainActor
final class ExploreModelTests: XCTestCase {
    private func proposal(_ id: String, targets: [String], recommended: Bool = false) -> String {
        #"{"id":"\#(id)","label":"balanced","recommended":\#(recommended),"distanceM":40000,"durationS":7200,"geometry":{"type":"LineString","coordinates":[[11,48],[11.1,48.1]]},"start":{"lat":48,"lon":11},"includedTargetIds":[\#(targets.map { "\"\($0)\"" }.joined(separator: ","))]}"#
    }

    private let catalog = #"{"collectibles":[{"id":"a","name":"A","latitude":48,"longitude":11,"found":false},{"id":"b","name":"B","latitude":48,"longitude":11,"found":false}]}"#
    private let bounds = WorldBounds(west: 11, south: 48, east: 11.5, north: 48.5)

    private func generated(_ proposals: [String]) -> StubTransport.Stub {
        .init(status: 200, body: #"{"explorationId":"e1","proposals":[\#(proposals.joined(separator: ","))],"catalog":\#(catalog)}"#)
    }

    func testGenerateSelectsRecommendedAndRerouteReplacesProposal() async {
        let transport = StubTransport([
            generated([proposal("p1", targets: ["a", "b"]), proposal("p2", targets: ["a"], recommended: true)]),
            .init(status: 200, body: #"{"proposal":\#(proposal("p3", targets: ["a"]))}"#)
        ])
        let model = ExploreModel(api: APIClient(baseURL: baseURL, transport: transport))
        model.begin(bounds: bounds, userLocation: nil)
        await model.generate()
        XCTAssertEqual(model.phase, .proposals)
        XCTAssertEqual(model.selectedId, "p2")
        await model.remove("a")
        XCTAssertNil(model.failure)
        XCTAssertEqual(model.selectedId, "p2")

        let model2 = ExploreModel(api: APIClient(baseURL: baseURL, transport: StubTransport([
            generated([proposal("p1", targets: ["a", "b"], recommended: true)]),
            .init(status: 200, body: #"{"proposal":\#(proposal("p3", targets: ["a"]))}"#)
        ])))
        model2.begin(bounds: bounds, userLocation: nil)
        await model2.generate()
        await model2.remove("b")
        XCTAssertEqual(model2.selectedId, "p3")
        XCTAssertTrue(model2.isCustomized)
        model2.reset()
        XCTAssertEqual(model2.selectedId, "p1")
        XCTAssertFalse(model2.isCustomized)
    }

    func testConfirmEndsExplorationAndKeepsPlannedRoute() async {
        let route = #"{"plannedRoute":{"questInstanceId":"q","distanceM":1,"durationS":1,"geometry":{"type":"LineString","coordinates":[[11,48],[11.1,48.1]]},"start":{"lat":48,"lon":11}}}"#
        let model = ExploreModel(api: APIClient(baseURL: baseURL, transport: StubTransport([
            generated([proposal("p1", targets: ["a"], recommended: true)]),
            .init(status: 200, body: route)
        ])))
        model.begin(bounds: bounds, userLocation: nil)
        await model.generate()
        await model.confirm()
        XCTAssertEqual(model.phase, .idle)
        XCTAssertEqual(model.displayedRoute.count, 2)
    }

    private func flowline(_ id: String) -> String {
        #"{"id":"\#(id)","name":"Flow \#(id)","geometry":{"type":"LineString","coordinates":[[11.1,48.1],[11.2,48.2]]},"completed":false}"#
    }

    func testGenerateListsRevealedFlowlinesNewFirstAndPlansViaOne() async throws {
        let withFlowlines = #"{"explorationId":"e1","proposals":[\#(proposal("p1", targets: [], recommended: true))],"catalog":{"collectibles":[],"flowlines":[\#(flowline("old")),\#(flowline("new"))]},"revealedFlowlineIds":["new"]}"#
        let again = withFlowlines.replacingOccurrences(of: #","revealedFlowlineIds":["new"]"#, with: #","revealedFlowlineIds":[]"#)
        let transport = StubTransport([.init(status: 200, body: withFlowlines), .init(status: 200, body: again)])
        let model = ExploreModel(api: APIClient(baseURL: baseURL, transport: transport))
        model.begin(bounds: bounds, userLocation: nil)
        await model.generate()
        XCTAssertEqual(model.flowlines.map(\.id), ["new", "old"])
        XCTAssertEqual(model.revealedFlowlineIds, ["new"])

        await model.planVia("old")
        XCTAssertEqual(model.phase, .proposals)
        XCTAssertEqual(model.destinationFlowline?.id, "old")
        XCTAssertEqual(model.revealedFlowlineIds, ["new"], "the reveal moment survives re-planning")
        let body = try XCTUnwrap(transport.requests.last?.httpBody)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(json["destinationFlowlineId"] as? String, "old")
        let first = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(transport.requests.first?.httpBody)) as? [String: Any])
        XCTAssertNil(first["destinationFlowlineId"])
    }

    func testBeginViaFlowlineFramesFlowlineAndStart() throws {
        let model = ExploreModel(api: APIClient(baseURL: baseURL, transport: StubTransport([])))
        let flowline = try JSONDecoder().decode(WorldFlowline.self, from: Data(flowline("f").utf8))
        model.begin(via: flowline, userLocation: GeoPoint(lat: 48, lon: 11))
        XCTAssertEqual(model.phase, .configure)
        XCTAssertEqual(model.destinationFlowline?.id, "f")
        XCTAssertTrue(model.useUserLocation)
        let area = try XCTUnwrap(model.area)
        XCTAssertLessThan(area.bounds.west, 11)
        XCTAssertGreaterThan(area.bounds.east, 11.2)
        XCTAssertLessThan(area.bounds.south, 48)
        XCTAssertGreaterThan(area.bounds.north, 48.2)
    }

    func testUnprocessableGenerateReportsNoRoute() async {
        let model = ExploreModel(api: APIClient(baseURL: baseURL, transport: StubTransport([.init(status: 422, body: #"{"error":"x"}"#)])))
        model.begin(bounds: bounds, userLocation: nil)
        await model.generate()
        XCTAssertEqual(model.failure, .noRoute)
        XCTAssertEqual(model.phase, .configure)
    }
}
