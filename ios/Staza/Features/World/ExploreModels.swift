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
    /// Flowlines this generate newly revealed to the player.
    var revealedFlowlineIds: [String]? = nil
}

struct RerouteResponse: Decodable, Sendable {
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

struct ExploreArea: Equatable, Sendable {
    let bounds: WorldBounds

    var center: GeoPoint { GeoPoint(lat: (bounds.south + bounds.north) / 2, lon: (bounds.west + bounds.east) / 2) }

    /// An area framing a Flowline and, when known, the player's start.
    static func around(_ flowline: WorldFlowline, start: GeoPoint?) -> ExploreArea? {
        let lats = flowline.coordinates.map(\.latitude) + (start.map { [$0.lat] } ?? [])
        let lons = flowline.coordinates.map(\.longitude) + (start.map { [$0.lon] } ?? [])
        guard let minLat = lats.min(), let maxLat = lats.max(), let minLon = lons.min(), let maxLon = lons.max() else { return nil }
        let padLat = max(0.01, (maxLat - minLat) * 0.5)
        let padLon = max(0.015, (maxLon - minLon) * 0.5)
        return ExploreArea(bounds: WorldBounds(west: minLon - padLon, south: minLat - padLat, east: maxLon + padLon, north: maxLat + padLat))
    }
}

struct GenerateRequest: Encodable, Sendable {
    struct Area: Encodable, Sendable {
        let bbox: String
        let center: GeoPoint
        let zoom: Double
    }
    struct Constraint: Encodable, Sendable {
        let type = "distance"
        let value: Double
    }
    let area: Area
    let start: GeoPoint
    let routeType = "round_trip"
    let constraint: Constraint
    /// A revealed Flowline every proposal must ride in full.
    var destinationFlowlineId: String? = nil
}

struct RerouteRequest: Encodable, Sendable {
    let proposalId: String
    let targetIds: [String]
}

struct ConfirmRequest: Encodable, Sendable {
    let proposalId: String
}
