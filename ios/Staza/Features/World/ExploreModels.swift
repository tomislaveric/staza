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
    /// Flowlines a generated route rides; the opportunity ones become its Flowline stops.
    var traversedFlowlines: [TraversedFlowline]? = nil

    struct TraversedFlowline: Decodable, Equatable, Sendable {
        let id: String
    }
}

struct ExplorationCatalog: Decodable, Equatable, Sendable {
    let collectibles: [WorldCollectible]
    /// Plannable Flowlines of the area: its opportunities and the player's completed ones.
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

/// `POST /api/explorations/save`: the saved, not yet started Exploration.
struct SavedExploration: Decodable, Sendable {
    let instance: QuestInstance?
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

/// The feel of a generated route. Staza never optimizes for speed.
enum RouteIntent: String, CaseIterable, Identifiable, Encodable, Sendable {
    /// Smooth Flowlines, few interruptions; places are secondary.
    case flow
    /// A relaxed, moderate mix.
    case chill
    /// A few good, varied places with small detours, never at the cost of route quality.
    case explore

    static let `default` = RouteIntent.chill
    var id: String { rawValue }

    /// The same name in every language.
    var name: String {
        switch self {
        case .flow: "Glide"
        case .chill: "Chill"
        case .explore: "Explore"
        }
    }

    var summary: LocalizedStringResource {
        switch self {
        case .flow: "route.intent.flow.description"
        case .chill: "route.intent.chill.description"
        case .explore: "route.intent.explore.description"
        }
    }
}

/// "Generate route": one route for the intent, bounded to the explored area and its opportunities.
struct SuggestRequest: Encodable, Sendable {
    let area: PlanArea
    let sport: String
    let start: GeoPoint
    let intent: RouteIntent
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

struct SaveRequest: Encodable, Sendable {
    let proposalId: String
}
