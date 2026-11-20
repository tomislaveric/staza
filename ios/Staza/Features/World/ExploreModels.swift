import CoreLocation
import Foundation

struct GeoPoint: Codable, Equatable, Sendable {
    let lat: Double
    let lon: Double
}

struct LineGeometry: Decodable, Equatable, Sendable {
    let coordinates: [[Double]]

    var clCoordinates: [CLLocationCoordinate2D] {
        coordinates.compactMap { $0.count >= 2 ? CLLocationCoordinate2D(latitude: $0[1], longitude: $0[0]) : nil }
    }
}

struct RouteProposal: Decodable, Equatable, Identifiable, Sendable {
    let id: String
    let label: String
    let recommended: Bool?
    let distanceM: Double
    let durationS: Double
    let elevationGainM: Double?
    let geometry: LineGeometry
    let start: GeoPoint
    let includedTargetIds: [String]
    let constraintFit: String?
    var flowlineIds: [String]? = nil
    var droppedFlowlineIds: [String]? = nil
    var droppedTargetIds: [String]? = nil
    var droppedWaypoints: [GeoPoint]? = nil
    /// Manual route stop order: collectible ids, `waypoint:<lat>,<lon>` and `flowline:<id>`.
    var stopOrder: [String]? = nil
}

struct ExplorationCatalog: Decodable, Equatable, Sendable {
    let collectibles: [WorldCollectible]
    /// Flowlines of the area the player has revealed.
    var flowlines: [WorldFlowline]? = nil
}

struct GeneratedExploration: Decodable, Equatable, Sendable {
    let explorationId: String
    let proposals: [RouteProposal]
    let catalog: ExplorationCatalog
}

/// `POST /api/explorations/plan`: the one route connecting the player's stops.
struct PlannedExploration: Decodable, Sendable {
    let explorationId: String
    let proposal: RouteProposal
}

struct PlannedRoute: Decodable, Equatable, Sendable {
    let questInstanceId: String?
    let distanceM: Double
    let durationS: Double
    let geometry: LineGeometry
    let start: GeoPoint
}

struct ConfirmedExploration: Decodable, Sendable {
    let plannedRoute: PlannedRoute?
}

/// The area sent with a plan or suggest request.
struct PlanArea: Encodable, Equatable, Sendable {
    let bbox: String
    let center: GeoPoint
    let zoom: Double

    init(bounds: WorldBounds, zoom: Double = 11) {
        bbox = bounds.queryValue
        center = GeoPoint(lat: (bounds.south + bounds.north) / 2, lon: (bounds.west + bounds.east) / 2)
        self.zoom = zoom
    }
}

/// "Suggest route": the old generator, bounded to the visible area and the player's revealed Flowlines.
struct SuggestRequest: Encodable, Sendable {
    let area: PlanArea
    let sport: String
    let start: GeoPoint
    let routeType = "round_trip"
}

struct PlanRequest: Encodable, Sendable {
    let area: PlanArea
    let sport: String
    let start: GeoPoint
    let routeType: String
    let end: GeoPoint?
    let keepOrder: Bool
    let stops: [PlannerStop]
}

struct ConfirmRequest: Encodable, Sendable {
    let proposalId: String
}
